#!/usr/bin/env node
// Apply the reviewed 131-case dependency plan to TestPilot only. No target system
// calls, submissions, approvals, SQL business writes or regression runs occur.
// Usage: node scripts/organize-department-prerequisites.mjs [--apply]
// Default is read-only; --apply creates one metadata version per changed module.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1]??fallback;};
const origin=arg('base-url','http://127.0.0.1:4323'),systemId=arg('system-id','436847ad-f144-425f-b303-1ca9b22e0b52');
const base=origin+'/api/system-module-regression',plan=JSON.parse(readFileSync(path.join(repo,'regression/plans/department-prerequisites-2026-11-05.json'),'utf8'));
async function get(url){const r=await fetch(url);const data=await r.json();if(!r.ok)throw Error(data.error??String(r.status));return data;}
const [catalog,state,core]=await Promise.all([get(base+'/case-editor?systemId='+systemId),get(base),get(base+'/core-chains?systemId='+systemId)]);
if(state.batches.some(b=>b.systemId===systemId&&['queued','running'].includes(b.phase))||core.runs.some(r=>['queued','running','awaiting-login'].includes(r.phase)))throw Error('Current project has an active batch.');
const byId=new Map(catalog.cases.map(c=>[c.id,c]));
if(plan.cases.length!==131||catalog.cases.length!==131||byId.size!==131)throw Error('Expected exactly 131 unique original cases.');
const versionSelections=Object.fromEntries(catalog.cases.map(c=>[c.moduleId,c.versionId]));
const cases=plan.cases.map(row=>{const c=byId.get(row.caseId);if(!c||c.title!==row.title||!catalog.modules.some(m=>m.id===c.moduleId&&m.name===row.moduleName))throw Error('Source changed: '+row.caseId);return {moduleId:c.moduleId,caseId:c.id,prerequisites:row.prerequisiteIds.map(id=>{const p=byId.get(id);if(!p)throw Error('Unknown prerequisite '+id);return {moduleId:p.moduleId,caseId:p.id};}),review:row.review};});
const report={systemId,total:cases.length,linked:cases.filter(c=>c.prerequisites.length).length,roots:cases.filter(c=>!c.prerequisites.length).length,pending:cases.filter(c=>c.review.status==='pending').map(c=>c.caseId)};
if(!process.argv.includes('--apply')){console.log(JSON.stringify({...report,applied:false},null,2));process.exit(0);}
const audit=path.join(repo,'runtime-data/dify/audit/prerequisites-20261105');mkdirSync(audit,{recursive:true});
if(catalog.cases.every(c=>JSON.stringify(c.prerequisites)===JSON.stringify(cases.find(v=>v.caseId===c.id).prerequisites)&&JSON.stringify(c.prerequisiteReview)===JSON.stringify(cases.find(v=>v.caseId===c.id).review))){console.log(JSON.stringify({...report,applied:false,alreadyCurrent:true},null,2));process.exit(0);}
// Preserve the state that is about to change. Never overwrite the first receipt.
const {existsSync}=await import('node:fs');const backup=path.join(audit,'before.json');if(existsSync(backup))throw Error('Prior receipt exists; inspect it before another apply.');
const packages=await Promise.all(catalog.modules.map(m=>get(base+'/modules/'+m.id)));
writeFileSync(backup,JSON.stringify({catalog,state,core,packages},null,2));
const payload={systemId,versionSelections,cases};writeFileSync(path.join(audit,'request.json'),JSON.stringify(payload,null,2));
const response=await fetch(base+'/case-editor/prerequisites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),receipt=await response.json();
writeFileSync(path.join(audit,'receipt.json'),JSON.stringify({status:response.status,receipt},null,2));
if(!response.ok)throw Error(receipt.error??'Apply failed.');
const after=await get(base+'/case-editor?systemId='+systemId),nextState=await get(base),afterCore=await get(base+'/core-chains?systemId='+systemId);
for(const c of after.cases){const old=byId.get(c.id),wanted=cases.find(v=>v.caseId===c.id);if(!old||JSON.stringify(c.prerequisites)!==JSON.stringify(wanted.prerequisites)||JSON.stringify(c.prerequisiteReview)!==JSON.stringify(wanted.review))throw Error('Readback differs: '+c.id);for(const field of ['id','title','expected','manualSteps','sourcePath','sourceExpected','status','resultAt'])if(JSON.stringify(old[field])!==JSON.stringify(c[field]))throw Error('Unexpected case change: '+c.id+' '+field);if(JSON.stringify(old.script.steps)!==JSON.stringify(c.script.steps))throw Error('Executable steps changed: '+c.id);}
if(JSON.stringify(state.batches)!==JSON.stringify(nextState.batches)||JSON.stringify(core)!==JSON.stringify(afterCore))throw Error('Historical results changed.');
const unchangedModules=state.modules.filter(m=>!catalog.modules.some(c=>c.id===m.id));if(unchangedModules.some(m=>JSON.stringify(m)!==JSON.stringify(nextState.modules.find(n=>n.id===m.id))))throw Error('Another module changed.');
const afterPackages=await Promise.all(catalog.modules.map(m=>get(base+'/modules/'+m.id)));for(const old of packages){const current=afterPackages.find(p=>p.module.id===old.module.id);if(JSON.stringify(old.cases)!==JSON.stringify(current.cases))throw Error('Original BrowserCheck source changed.');}
writeFileSync(path.join(audit,'after.json'),JSON.stringify({catalog:after,packages:afterPackages},null,2));writeFileSync(path.join(audit,'summary.json'),JSON.stringify({...report,receipt,readbackMatches:true,originalCasesAndStepsUnchanged:true,historicalResultsUnchanged:true,otherModulesUnchanged:true},null,2));
console.log(JSON.stringify({...report,applied:true,readbackMatches:true,originalCasesAndStepsUnchanged:true,historicalResultsUnchanged:true},null,2));
