#!/usr/bin/env node
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertDifyExportSafe} from '../dist/adapters/dify-export-policy.js';

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exists=async file=>access(file).then(()=>true,()=>false);
const uuid=/^[0-9a-f-]{36}$/i;
const readRecords=(root,file,kind)=>{const db=new DatabaseSync(path.join(root,file),{readOnly:true});try{return db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.payload));}finally{db.close();}};
const catalogFile='system-module-regression/catalog.sqlite',moduleFile='dify-web-modules/records.sqlite';

export async function exportDifyConfiguration(root,systemId){
 if(!uuid.test(systemId))throw Error('Specify an existing system UUID.');
 const systems=readRecords(root,catalogFile,'system').filter(s=>s.id===systemId);
 if(systems.length!==1)throw Error('System not found.');
 const active=readRecords(root,catalogFile,'batch').some(b=>b.systemId===systemId&&['queued','running'].includes(b.phase));
 if(active)throw Error('Finish the active batch before exporting configuration.');
 const modules=readRecords(root,catalogFile,'module').filter(m=>m.systemId===systemId);
 const versionIds=new Set(modules.flatMap(m=>m.versions.map(v=>v.id)));
 const versions=readRecords(root,moduleFile,'module').filter(m=>versionIds.has(m.id));
 if(versions.length!==versionIds.size)throw Error('A referenced module version is missing.');
 const system=structuredClone(systems[0]);system.notifyFailures=false;system.notifyScreenshots=false;
 const fixtures={};
 for(const file of ['book-fixtures.json','readonly-fixtures.json'])if(await exists(path.join(root,'dify-web-modules',file)))fixtures[file]=JSON.parse(await readFile(path.join(root,'dify-web-modules',file),'utf8'));
 const payload={systems:[system],modules,versions,fixtures};
 assertDifyExportSafe(payload);
 return {schema:1,kind:'testpilot-dify-configuration',createdAt:new Date().toISOString(),notice:'Configuration and selected stable business test fixtures only. No login sessions, secrets, jobs, reports or target database dumps. Treat case content as private.',payload,digest:sha(payload)};
}

export async function importDifyConfiguration(root,bundle){
 if(bundle?.schema!==1||bundle.kind!=='testpilot-dify-configuration'||!bundle.payload||sha(bundle.payload)!==bundle.digest)throw Error('Invalid or changed configuration bundle.');
 const p=bundle.payload;assertDifyExportSafe(p);
 if(!Array.isArray(p.systems)||p.systems.length!==1||!Array.isArray(p.modules)||!Array.isArray(p.versions)||!p.fixtures||Object.keys(p.fixtures).some(k=>!['book-fixtures.json','readonly-fixtures.json'].includes(k)))throw Error('Unsupported bundle contents.');
 const system=p.systems[0],versionIds=new Set(p.versions.map(v=>v.id));
 if(!uuid.test(system.id)||p.modules.some(m=>!uuid.test(m.id)||m.systemId!==system.id||!Array.isArray(m.versions)||m.versions.some(v=>!versionIds.has(v.id)))||p.versions.some(v=>!uuid.test(v.id)||!v.project||!Array.isArray(v.project.cases)))throw Error('Broken module/version references.');
 const target=path.resolve(root);
 // Never merge/replace a live or previously populated data directory. Keep it
 // for rollback and choose a fresh destination instead.
 if(await exists(path.join(target,catalogFile))||await exists(path.join(target,moduleFile)))throw Error('Destination already has a Dify catalog. Stop the app and use a fresh data directory; existing state was not modified.');
 for(const file of Object.keys(p.fixtures))if(await exists(path.join(target,'dify-web-modules',file)))throw Error('Destination already has local fixtures; choose a fresh data directory.');
 const mapped=structuredClone(system);mapped.profileId=randomUUID();mapped.notifyFailures=false;mapped.notifyScreenshots=false;
 if(mapped.accountProfiles)mapped.accountProfiles=mapped.accountProfiles.map(a=>({id:randomUUID(),name:a.name}));
 delete mapped.activeAccountId;
 await mkdir(path.dirname(path.join(target,catalogFile)),{recursive:true});await mkdir(path.dirname(path.join(target,moduleFile)),{recursive:true});
 const modulesDb=new DatabaseSync(path.join(target,moduleFile)),catalog=new DatabaseSync(path.join(target,catalogFile));
 try{
  modulesDb.exec('CREATE TABLE records(kind TEXT,id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,job_id TEXT NOT NULL)');
  catalog.exec('CREATE TABLE records(kind TEXT,id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,batch_id TEXT NOT NULL)');
  modulesDb.exec('BEGIN');for(const version of p.versions)modulesDb.prepare('INSERT INTO records VALUES(?,?,?)').run('module',version.id,JSON.stringify(version));modulesDb.exec('COMMIT');
  catalog.exec('BEGIN');catalog.prepare('INSERT INTO records VALUES(?,?,?)').run('system',mapped.id,JSON.stringify(mapped));for(const module of p.modules)catalog.prepare('INSERT INTO records VALUES(?,?,?)').run('module',module.id,JSON.stringify(module));catalog.exec('COMMIT');
 }finally{modulesDb.close();catalog.close();}
 for(const [file,value]of Object.entries(p.fixtures))await writeFile(path.join(target,'dify-web-modules',file),JSON.stringify(value,null,2),{flag:'wx'});
 return {system:mapped.name,modules:p.modules.length,latestCases:p.modules.reduce((n,m)=>n+p.versions.find(v=>v.id===m.versions.at(-1).id).project.cases.length,0),minimalCases:p.modules.reduce((n,m)=>n+(m.starterCaseIds?.length??0),0),historyImported:false,loginRequired:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),mode=args.shift(),value=key=>{const index=args.indexOf(key);return index<0?undefined:args[index+1];};
 try{
  const root=value('--data-dir')??'artifacts/demo';
  if(mode==='export'){
   const output=value('--output');if(!output)throw Error('Use export --system UUID --output PRIVATE_FILE.json [--data-dir artifacts/demo].');
   const bundle=await exportDifyConfiguration(root,value('--system'));await mkdir(path.dirname(path.resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(bundle,null,2),{flag:'wx'});
   console.log(JSON.stringify({exported:path.resolve(output),systems:1,modules:bundle.payload.modules.length,secretsIncluded:false,historyIncluded:false}));
  }else if(mode==='import'){
   const input=value('--input');if(!input)throw Error('Use import --input PRIVATE_FILE.json [--data-dir artifacts/demo].');
   console.log(JSON.stringify(await importDifyConfiguration(root,JSON.parse(await readFile(input,'utf8')))));
  }else throw Error('Use export or import. See docs/collaboration/Dify新电脑交接-2026-11-01.md.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
