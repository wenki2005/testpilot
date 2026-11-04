#!/usr/bin/env node
// Append missing, completed Dify history and referenced screenshots only.
// Example: node scripts/verify/append-dify-terminal-results.mjs --source D:/demo/artifacts/demo-toolrun [--apply]
// Default is a read-only plan. Apply requires the Dify backend stopped, makes
// SQLite online backups, never overwrites existing records or copies credentials,
// and does not call the tested business system. The web workspace is untouched.
import{DatabaseSync,backup}from'node:sqlite';
import{readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync,constants}from'node:fs';
import{createHash}from'node:crypto';import path from'node:path';
import{argument,workspacePaths}from'../lib/integrated-workspaces.mjs';
const source=path.resolve(argument('source')??(()=>{throw Error('--source required');})()),target=workspacePaths('dify').root,apply=process.argv.includes('--apply'),systemId='436847ad-f144-425f-b303-1ca9b22e0b52';
if(source.toLowerCase()===target.toLowerCase())throw Error('Source and target must differ');
const rels=['system-module-regression/catalog.sqlite','dify-web-modules/records.sqlite'];
const src=rels.map(r=>new DatabaseSync(path.join(source,r),{readOnly:true}));
const dst=rels.map(r=>new DatabaseSync(path.join(target,r),{readOnly:!apply}));
const hash=b=>createHash('sha256').update(b).digest('hex'),uuid=/^[0-9a-f-]{36}$/i;
const row=(db,kind,id)=>db.prepare('SELECT kind,id,payload FROM records WHERE kind=? AND id=?').get(kind,id);
const value=(db,kind,id)=>{const r=row(db,kind,id);if(!r)throw Error('Missing '+kind+' identity');return JSON.parse(r.payload);};
try{
 const a=value(src[0],'system',systemId),b=value(dst[0],'system',systemId);
 if(['profileId','targetUrl','environment'].some(k=>a[k]!==b[k]))throw Error('Different system/account/environment');
 const batches=src[0].prepare("SELECT kind,id,payload FROM records WHERE kind='batch' ORDER BY rowid").all().filter(r=>{const b=JSON.parse(r.payload);return b.systemId===systemId&&!row(dst[0],'batch',r.id);});
 const jobs=new Map(),files=new Map();
 const file=relative=>{
  const from=path.join(source,relative),to=path.join(target,relative);if(!existsSync(from))throw Error('Referenced evidence missing in source');
  const bytes=readFileSync(from),fingerprint=hash(bytes);if(existsSync(to)&&hash(readFileSync(to))!==fingerprint)throw Error('Existing destination file differs; refusing overwrite');
  files.set(relative,{from,to,sha256:fingerprint,alreadyPresent:existsSync(to)});
 };
 for(const r of batches){
  const batch=JSON.parse(r.payload);if(!['completed','cancelled','interrupted'].includes(batch.phase)||batch.profileId!==(b.activeAccountId??b.profileId)||batch.targetUrl!==b.targetUrl||batch.environment!==b.environment)throw Error('Incoming batch not terminal or context differs');
  for(const entry of batch.entries){
   const sourceModule=value(src[0],'module',entry.moduleId),targetModule=value(dst[0],'module',entry.moduleId),sv=sourceModule.versions.find(v=>v.id===entry.versionId),tv=targetModule.versions.find(v=>v.id===entry.versionId);
   if(!sv||!tv||sv.digest!==tv.digest||sv.caseCount!==tv.caseCount)throw Error('Immutable module version differs');
   const jobRow=row(src[1],'job',entry.jobId);if(!jobRow)throw Error('Incoming job missing');const job=JSON.parse(jobRow.payload);
   if(!['completed','blocked','error','cancelled','interrupted'].includes(job.phase)||job.moduleId!==entry.versionId||!uuid.test(job.id))throw Error('Incoming job state/version invalid');
   const old=row(dst[1],'job',job.id);if(old&&old.payload!==jobRow.payload)throw Error('Existing job differs; refusing overwrite');jobs.set(job.id,jobRow);
   for(const result of job.results){
    if(!result.evidence)continue;if(!/^[0-9a-f]{64}\.png$/i.test(result.evidence))throw Error('Unexpected evidence identifier');
    const authorized=job.authorizedWriteCaseIds?.includes(result.caseId);
    if(result.evidenceOrigin==='preflight'||authorized&&(result.evidenceOrigin==='authorized-write'||!result.evidenceOrigin))file(path.join('dify-web-modules','evidence',job.id,result.evidence));
    else if(job.documentRunId&&uuid.test(job.documentRunId))file(path.join('document-tests','runs',job.documentRunId,'screenshots',result.evidence));
    else throw Error('Evidence origin cannot be resolved');
   }
   const journal=path.join('dify-web-modules','authorized-writes',job.id+'.json');if(existsSync(path.join(source,journal)))file(journal);
  }
 }
 const batchIds=new Set(batches.map(r=>r.id)),jobIds=new Set(jobs.keys());
 const requests=[src[0].prepare('SELECT * FROM requests').all().filter(r=>batchIds.has(r.batch_id)),src[1].prepare('SELECT * FROM requests').all().filter(r=>jobIds.has(r.job_id))];
 requests.forEach((rows,i)=>rows.forEach(r=>{const old=dst[i].prepare('SELECT * FROM requests WHERE id=?').get(r.id);if(old&&JSON.stringify(old)!==JSON.stringify(r))throw Error('Existing request binding differs');}));
 const summary={at:new Date().toISOString(),mode:apply?'apply':'plan',batches:batches.length,jobs:jobs.size,files:files.size,requests:requests.map(r=>r.length),replayedBusiness:false,overwrittenRecords:0};
 if(apply&&batches.length){
  let running=false;try{running=(await fetch('http://127.0.0.1:4323/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(running)throw Error('Stop the owned Dify backend before apply');
  const backupDir=path.join(target,'private','result-sync-backups',new Date().toISOString().replaceAll(':','-'));mkdirSync(backupDir,{recursive:true});
  await backup(dst[0],path.join(backupDir,'catalog.sqlite'));await backup(dst[1],path.join(backupDir,'records.sqlite'));summary.backupDir=backupDir;
  for(const v of files.values())if(!v.alreadyPresent){mkdirSync(path.dirname(v.to),{recursive:true});copyFileSync(v.from,v.to,constants.COPYFILE_EXCL);if(hash(readFileSync(v.to))!==v.sha256)throw Error('Copied evidence hash mismatch');}
  dst[0].exec('BEGIN IMMEDIATE');dst[1].exec('BEGIN IMMEDIATE');
  try{
   for(const r of jobs.values())if(!row(dst[1],'job',r.id))dst[1].prepare('INSERT INTO records(kind,id,payload) VALUES(?,?,?)').run(r.kind,r.id,r.payload);
   for(const r of batches)dst[0].prepare('INSERT INTO records(kind,id,payload) VALUES(?,?,?)').run(r.kind,r.id,r.payload);
   requests.forEach((rows,i)=>rows.forEach(r=>{if(!dst[i].prepare('SELECT id FROM requests WHERE id=?').get(r.id))dst[i].prepare('INSERT INTO requests VALUES(?,?,?)').run(r.id,r.fingerprint,i===0?r.batch_id:r.job_id);}));
   dst[1].exec('COMMIT');dst[0].exec('COMMIT');
  }catch(e){for(const db of dst)try{db.exec('ROLLBACK');}catch{}throw e;}
  for(const db of dst)if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw Error('Target integrity check failed');
  writeFileSync(path.join(backupDir,'append-manifest.json'),JSON.stringify({...summary,batchIds:[...batchIds],jobIds:[...jobIds],files:[...files].map(([file,v])=>({file,sha256:v.sha256}))},null,2));
 }
 console.log(JSON.stringify(summary));
}finally{for(const db of[...src,...dst])db.close();}
