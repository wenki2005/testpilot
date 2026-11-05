#!/usr/bin/env node
// Copy a stopped workspace to external user storage, preserving all local records,
// screenshots, private configuration and browser profiles. Source is never deleted.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {argument,workspacePaths,legacyRuntimeRoot} from '../lib/integrated-workspaces.mjs';

const workspace=workspacePaths(argument('workspace','dify'));
const source=await fs.realpath(path.resolve(argument('source')??path.join(legacyRuntimeRoot,workspace.owner)));
const destination=path.resolve(workspace.root),apply=process.argv.includes('--apply');
const fold=p=>process.platform==='win32'?p.toLowerCase():p;
const from=fold(source),to=fold(destination);
if(from===to||from.startsWith(to+path.sep)||to.startsWith(from+path.sep))throw Error('Source and destination must be separate directories.');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root,prefix=''){const files=[];for(const e of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){const relative=path.join(prefix,e.name),full=path.join(root,relative);if(e.isSymbolicLink())throw Error('Linked data cannot be relocated: '+relative);if(e.isDirectory())files.push(...await inventory(root,relative));else if(e.isFile()&&!/(?:-wal|-shm|-journal)$/.test(e.name)){const stat=await fs.stat(full);files.push({relative,bytes:stat.size});}}return files;}
const files=await inventory(source);
if(!apply){console.log(JSON.stringify({workspace:workspace.owner,source,destination,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),apply:false,sourcePreserved:true},null,2));process.exit(0);}
try{await fs.access(destination);throw Error('Destination already exists; existing user data is never overwritten.');}catch(error){if(error.code!=='ENOENT')throw error;}
const processFile=path.join(path.dirname(source),workspace.owner+'-process.json');
try{const meta=JSON.parse(await fs.readFile(processFile,'utf8'));if(fold(path.resolve(meta.dataDir))===from){let running=true;try{process.kill(meta.pid,0);}catch(error){if(error.code==='ESRCH')running=false;else throw error;}if(running)throw Error('Stop the source workspace before applying relocation.');}}catch(error){if(error.code!=='ENOENT')throw error;}
if(process.platform==='win32'){
 const quoted="'"+source.replaceAll("'","''")+"'";
 const command="$needle="+quoted+";$running=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge)\\.exe$' -and $_.CommandLine -and $_.CommandLine.IndexOf($needle,[StringComparison]::OrdinalIgnoreCase) -ge 0 });if($running.Count){throw 'Close the browser using this workspace before relocation.'}";
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:'pipe'});
}
const stage=path.join(path.dirname(destination),'.relocate-'+workspace.owner+'-'+randomUUID());
if(!fold(stage).startsWith(fold(path.dirname(destination))+path.sep)||!path.basename(stage).startsWith('.relocate-'))throw Error('Invalid staging path.');
await fs.mkdir(stage,{recursive:true});
const sourcePrefix=source.replaceAll('\\','/');
let rewrittenReferences=0;
const rewrite=value=>{if(typeof value==='string'){let fileUrl=false,local=value;if(value.startsWith('file://')){try{local=fileURLToPath(value);fileUrl=true;}catch{return value;}}const normalized=local.replaceAll('\\','/');if(fold(normalized)===fold(sourcePrefix)||fold(normalized).startsWith(fold(sourcePrefix)+'/')){rewrittenReferences++;const updated=destination.replaceAll('\\','/')+normalized.slice(sourcePrefix.length);return fileUrl?pathToFileURL(updated).href:updated;}return value;}if(Array.isArray(value))return value.map(rewrite);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));return value;};
const receipt=[];
for(const f of files){
 const input=path.join(source,f.relative),output=path.join(stage,f.relative);await fs.mkdir(path.dirname(output),{recursive:true});
 const header=Buffer.alloc(16),handle=await fs.open(input,'r');try{await handle.read(header,0,16,0);}finally{await handle.close();}
 const before=await fs.readFile(input),originalHash=hash(before);
 if(header.toString('utf8')==='SQLite format 3\0'){
  const db=new DatabaseSync(input,{readOnly:true});try{await backup(db,output);}finally{db.close();}
  const copied=new DatabaseSync(output);try{
   if(Object.values(copied.prepare('PRAGMA quick_check').get())[0]!=='ok')throw Error('Copied SQLite integrity check failed.');
   const tables=copied.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
   for(const {name}of tables){const quote=value=>'"'+String(value).replaceAll('"','""')+'"',table=quote(name);const info=copied.prepare('PRAGMA table_info('+table+')').all(),columns=info.filter(c=>/TEXT|JSON/i.test(c.type));
    for(const column of columns){const col=quote(column.name);let rows,keys;try{rows=copied.prepare('SELECT rowid AS __tp_rowid,'+col+' AS __tp_value FROM '+table).all();keys=['__tp_rowid'];}catch{keys=info.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);if(!keys.length)throw Error('Cannot verify reference updates for '+name);rows=copied.prepare('SELECT '+keys.map(quote).join(',')+','+col+' AS __tp_value FROM '+table).all();}
     for(const row of rows){if(typeof row.__tp_value!=='string')continue;let value;try{value=JSON.parse(row.__tp_value);}catch{continue;}const count=rewrittenReferences,next=rewrite(value);if(rewrittenReferences!==count){const where=keys.map(k=>(k==='__tp_rowid'?'rowid':quote(k))+'=?').join(' AND ');copied.prepare('UPDATE '+table+' SET '+col+'=? WHERE '+where).run(JSON.stringify(next),...keys.map(k=>row[k]));}}
    }
   }
   copied.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }finally{copied.close();}
 }else{
  let bytes=before;
  if(f.relative.endsWith('.json')){try{const original=JSON.parse(before.toString('utf8')),count=rewrittenReferences,next=rewrite(original);if(count!==rewrittenReferences)bytes=Buffer.from(JSON.stringify(next,null,2)+'\n');}catch{}}
  await fs.writeFile(output,bytes);
 }
 // Offline migration must not race with changing source files, including private state.
 if(hash(await fs.readFile(input))!==originalHash)throw Error('Source changed during relocation: '+f.relative);
 receipt.push({path:f.relative.replaceAll('\\','/'),sourceSha256:originalHash,destinationSha256:hash(await fs.readFile(output))});
}
const finalFiles=await inventory(source);
if(JSON.stringify(finalFiles)!==JSON.stringify(files))throw Error('Source inventory changed during relocation.');
for(const f of receipt)if(hash(await fs.readFile(path.join(source,f.path)))!==f.sourceSha256)throw Error('Source changed after copying: '+f.path);
const manifest={schema:1,workspace:workspace.owner,source,destination,completedAt:new Date().toISOString(),sourcePreserved:true,browserSessionsCopied:true,rewrittenReferences,files:receipt};
await fs.writeFile(path.join(stage,'relocation-'+randomUUID()+'.json'),JSON.stringify(manifest,null,2)+'\n');
if(!fold(stage).startsWith(fold(path.dirname(destination))+path.sep)||fold(stage)===to)throw Error('Unsafe final staging path.');
await fs.rename(stage,destination);
console.log(JSON.stringify({workspace:workspace.owner,destination,files:receipt.length,rewrittenReferences,sourcePreserved:true,browserSessionsCopied:true},null,2));
