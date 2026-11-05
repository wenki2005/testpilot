#!/usr/bin/env node
/**
 * Export the current case editor definitions as individual reviewable files.
 * GET only; no jobs, target-system calls, SQL writes, credentials or screenshots.
 * This snapshot is not an installable seed and does not synchronize edits back.
 * Usage: node scripts/export-project-resources.mjs --system <UUID> --out <new-directory>
 */
import {mkdir,writeFile,access,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {assertDifyExportSafe} from '../../dist/adapters/regression/exports/export-policy.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),allowed=new Set(['--system','--out','--base-url']);
if(args.includes('--help')){
 console.log('node scripts/export-project-resources.mjs --system <UUID> --out <new-directory> [--base-url http://127.0.0.1:4323]');
 process.exit(0);
}
const values={};
for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||args[i+1].startsWith('--')||values[args[i]])throw Error('Invalid or duplicate argument. Use --help.');values[args[i]]=args[i+1];}
if(!/^[0-9a-f-]{36}$/i.test(values['--system']??'')||!values['--out'])throw Error('--system UUID and --out are required.');
const base=new URL(values['--base-url']??'http://127.0.0.1:4323');
if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.search||base.hash)throw Error('Use a local TestPilot HTTP endpoint without credentials.');
const endpoint=base.href.replace(/\/$/,'')+'/api/system-module-regression';
async function get(suffix){const r=await fetch(endpoint+suffix,{signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)throw Error('Resource read failed: HTTP '+r.status);return r.json();}
const systemId=values['--system'],query='?systemId='+encodeURIComponent(systemId);
const [catalog,core]=await Promise.all([get('/case-editor'+query),get('/core-chains'+query)]);
const project=catalog.systems.find(s=>s.id===systemId);
if(!project||catalog.systemId!==systemId)throw Error('Requested project was not returned.');
const slugs=['01-login','02-application','03-approval','04-orders-logistics','05-clients'];
const names=['登录入口与公共基础','申样申请与经销商数据','申请记录与审批详情','订单与物流','PC/H5 横向适配'];
const modulePath=new Map(catalog.modules.map(m=>{const i=names.indexOf(m.name);return [m.id,i<0?'module-'+m.id:slugs[i]];}));
const seen=new Set();
for(const c of catalog.cases){const key=c.moduleId+':'+c.id;if(!modulePath.has(c.moduleId)||!/^[-a-zA-Z0-9_]{1,80}$/.test(c.id)||seen.has(key))throw Error('Invalid or duplicate case reference.');seen.add(key);}
const caseDefinition=c=>({id:c.id,moduleId:c.moduleId,versionId:c.versionId,version:c.version,title:c.title,expected:c.expected,manualSteps:c.manualSteps,prerequisites:c.prerequisites,...(c.prerequisiteReview?{prerequisiteReview:c.prerequisiteReview}:{}),sourcePath:c.sourcePath,sourceExpected:c.sourceExpected});
const scriptDefinition=c=>({caseId:c.id,moduleId:c.moduleId,versionId:c.versionId,version:c.version,dependsOn:c.script.dependsOn,hasSteps:c.script.steps.length>0,steps:c.script.steps});
const definitions=(core.definitions??[]).map(c=>({id:c.id,title:c.title,description:c.description,steps:c.steps.map(s=>({id:s.id,title:s.title,expected:s.expected,caseIds:s.caseIds}))}));
const files=new Map();
const json=(file,value)=>files.set(file,JSON.stringify(value,null,2)+'\n');
json('project.json',{schema:1,id:project.id,name:project.name,format:'testpilot-case-editor-snapshot',installableSeed:false});
json('modules.json',catalog.modules.map(m=>({id:m.id,name:m.name,directory:modulePath.get(m.id),caseKeys:m.caseKeys})));
for(const c of catalog.cases){json('cases/'+modulePath.get(c.moduleId)+'/'+c.id+'.json',caseDefinition(c));json('scripts/'+modulePath.get(c.moduleId)+'/'+c.id+'.json',scriptDefinition(c));}
for(const chain of definitions){if(!/^[-a-zA-Z0-9_]+$/.test(chain.id))throw Error('Invalid chain identifier.');for(const s of chain.steps)for(const id of s.caseIds)if(!catalog.cases.some(c=>c.id===id))throw Error('Missing chain case '+id);json('chains/'+chain.id+'.json',chain);}
for(const c of catalog.cases){for(const d of c.prerequisites??[])if(!seen.has(d.moduleId+':'+d.caseId))throw Error('Missing prerequisite reference.');if(c.script.caseId!==c.id)throw Error('Mismatched script reference.');}
json('config/environment.example.json',{targetUrl:'',databaseConnectionName:'',note:'Fill these values on your own machine. Do not commit credentials or login sessions.'});
files.set('fixtures/README.md','# 测试数据模板\n\n此目录只收录经过确认可共享的输入模板。本次未复制真实申请、订单、库存快照或账号数据。\n');
files.set('README.md','# 部门申样项目资源\n\n来自当前网页有效用例及脚本的只读快照，每条用例和脚本按稳定 ID 单独存放。\n\n- cases：原文、预期、人工步骤、前置关系及版本引用。\n- scripts：当前有效步骤与前置要求；hasSteps=false 的定义仍完整保留。\n- chains：核心链路及按顺序引用的用例。\n- config：不含凭据的配置模板。\n- fixtures：可共享测试输入模板的存放位置，本次未复制真实业务样本。\n\n本快照没有运行记录、通过状态、截图、账号配置或登录态。修改文件暂不会自动同步回网页，首次安装资源导入仍需实现；此目录不等于可独立运行的安装包。\n');
for(const [name,body]of files){assertDifyExportSafe(JSON.parse(name.endsWith('.json')?body:JSON.stringify(body)));if(/\b(?:Bearer\s+[a-zA-Z0-9._-]{12,}|sk-[a-zA-Z0-9_-]{16,})|(?:password|passwd|api_key|access_token)\s*[:=]\s*["']?[^\s"',}]{5,}/i.test(body))throw Error('Potential credential in '+name);}
const snapshot=c=>({modules:c.modules,cases:c.cases.map(v=>({definition:caseDefinition(v),script:scriptDefinition(v)})),chains:c.chains});
const again=await get('/case-editor'+query),coreAgain=await get('/core-chains'+query);
if(JSON.stringify(snapshot(catalog))!==JSON.stringify(snapshot(again))||JSON.stringify(core.definitions)!==JSON.stringify(coreAgain.definitions))throw Error('Definitions changed during export. No output created.');
const sha=body=>createHash('sha256').update(body).digest('hex');
const manifest={schema:1,kind:'testpilot-case-editor-snapshot',projectId:systemId,exportedAt:new Date().toISOString(),installableSeed:false,historyIncluded:false,credentialsIncluded:false,counts:{modules:catalog.modules.length,cases:catalog.cases.length,scriptsWithSteps:catalog.cases.filter(c=>c.script.steps.length>0).length,chains:definitions.length},files:[...files].map(([file,body])=>({file,sha256:sha(body)}))};
json('manifest.json',manifest);
const out=path.resolve(repo,values['--out']),exists=await access(out).then(()=>true,()=>false);
if(exists)throw Error('Destination exists; choose a new directory and review the diff.');
// Never write into the live data or application code, even if the caller mistypes --out.
for(const forbidden of ['src','web','dist','runtime-data','artifacts','.git','node_modules']){const rel=path.relative(path.join(repo,forbidden),out);if(!rel||(!rel.startsWith('..')&&!path.isAbsolute(rel)))throw Error('Destination overlaps protected directory.');}
await mkdir(path.dirname(out),{recursive:true});const stage=out+'.export-'+randomUUID();await mkdir(stage);
for(const [name,body]of files){const file=path.join(stage,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,body,{flag:'wx'});}
await rename(stage,out);
console.log(JSON.stringify({output:out,...manifest.counts,files:files.size,historyIncluded:false,installableSeed:false}));
