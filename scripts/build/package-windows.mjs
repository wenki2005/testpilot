#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {HttpsProxyAgent} from 'https-proxy-agent';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),values={};
for(let i=0;i<args.length;i+=2){if(!['--dir','--zip','--node-license','--package-manager','--dependencies'].includes(args[i])||!args[i+1])throw Error('Usage: npm run package:windows -- --dir <new directory> [--zip <archive>] [--node-license <license file>] [--package-manager <pnpm JS entry>] [--dependencies <portable node_modules>]');values[args[i]]=args[i+1];}
if(process.platform!=='win32')throw Error('Build this Windows distribution on Windows.');
const dir=path.resolve(values['--dir']??path.join(repo,'..','release-output','TestPilot-Windows-'+new Date().toISOString().slice(0,10))),zip=path.resolve(values['--zip']??dir+'.zip');
if(fs.existsSync(dir)||fs.existsSync(zip))throw Error('A release already exists. Choose a new directory; no package was overwritten.');
if(dir===repo||dir.startsWith(repo+path.sep)||zip.startsWith(dir+path.sep))throw Error('Distribution must be outside the source checkout and ZIP outside its directory.');
const stage=path.join(path.dirname(dir),'.package-'+path.basename(dir)+'-'+Date.now());
fs.mkdirSync(stage,{recursive:true});
const excluded=new Set(['.git','node_modules','.local','.cache']);
function copyTree(source,destination,isDependencies=false){
 const sourceRelative=path.relative(repo,source).replaceAll('\\','/');
 if(!isDependencies&&/^tests\/(?:.*\/)?(?:artifacts|test-artifacts|runtime-data|dist|node_modules)(?:\/|$)/.test(sourceRelative))return;
 const entry=fs.lstatSync(source);if(entry.isSymbolicLink())throw Error('Linked package input is not supported: '+source);
 if(entry.isDirectory()){fs.mkdirSync(destination,{recursive:true});for(const name of fs.readdirSync(source)){if(name==='.cache'||name==='.git'||isDependencies&&['.modules.yaml','.pnpm-workspace-state-v1.json'].includes(name)||(!isDependencies&&excluded.has(name))||/^\.env(?:\.|$)/.test(name)&&!['.env.example','.env.regression.example'].includes(name))continue;copyTree(path.join(source,name),path.join(destination,name),isDependencies);}return;}
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);
}
const sourceDirs=['src','web/src','project-resources','regression','integrations','scripts','packaging','examples','tests','docs','.agents','.github'];
for(const relative of sourceDirs)copyTree(path.join(repo,relative),path.join(stage,relative));
for(const relative of ['package.json','package-lock.json','tsconfig.json','playwright.config.ts','web/index.html','web/tsconfig.json','web/vite.config.ts','.env.example','.env.regression.example','.gitignore','.gitattributes','AGENTS.md','代码导航.md','启动测试工作台.cmd','停止测试工作台.cmd'])copyTree(path.join(repo,relative),path.join(stage,relative));
if(values['--dependencies'])copyTree(path.resolve(values['--dependencies']),path.join(stage,'node_modules'),true);
else if(fs.existsSync(path.join(repo,'node_modules/.pnpm'))||values['--package-manager']){
 const manager=path.resolve(values['--package-manager']??path.join(path.dirname(process.execPath),'../node_modules/pnpm/bin/pnpm.mjs'));
 if(!fs.existsSync(manager))throw Error('A pnpm source install needs a portable hoisted dependency layout. Pass --package-manager with its JS entry.');
 const options={cwd:stage,stdio:'inherit',windowsHide:true,env:{...process.env,CI:'true'}};
 execFileSync(process.execPath,[manager,'import'],options);
 const install=[manager,'install','--frozen-lockfile','--ignore-scripts','--node-linker=hoisted','--package-import-method=copy'];
 try{execFileSync(process.execPath,[...install,'--offline'],options);}catch{execFileSync(process.execPath,install,options);}
 fs.unlinkSync(path.join(stage,'pnpm-lock.yaml'));
}else copyTree(path.join(repo,'node_modules'),path.join(stage,'node_modules'),true);
fs.mkdirSync(path.join(stage,'runtime'),{recursive:true});
fs.copyFileSync(process.execPath,path.join(stage,'runtime/node.exe'));
const licenseUrl='https://raw.githubusercontent.com/nodejs/node/'+process.version+'/LICENSE';
async function license(){if(values['--node-license'])return fs.readFileSync(path.resolve(values['--node-license']));return new Promise((resolve,reject)=>{const proxy=process.env.HTTPS_PROXY||process.env.https_proxy,request=https.get(licenseUrl,{...(proxy?{agent:new HttpsProxyAgent(proxy)}:{})},res=>{if(res.statusCode!==200){res.resume();reject(Error('Cannot obtain exact Node license: HTTP '+res.statusCode));return;}const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve(Buffer.concat(chunks)));});request.setTimeout(30000,()=>request.destroy(Error('Node license download timeout; pass --node-license to use a local copy.')));request.on('error',reject);});}
const nodeLicense=await license();if(!nodeLicense.toString('utf8').includes('Node.js'))throw Error('Node license input was not recognized.');fs.writeFileSync(path.join(stage,'runtime/LICENSE'),nodeLicense);
console.log('Dependencies and Node copied; compiling staged sources.');
execFileSync(process.execPath,[path.join(stage,'node_modules/typescript/bin/tsc'),'-p',path.join(stage,'tsconfig.json')],{cwd:stage,stdio:'inherit',windowsHide:true});
execFileSync(process.execPath,[path.join(stage,'node_modules/vite/bin/vite.js'),'build','web'],{cwd:stage,stdio:'inherit',windowsHide:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const resourceManifest=JSON.parse(fs.readFileSync(path.join(stage,'project-resources/department-sample/manifest.json'),'utf8'));
let commit='uncommitted';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim();}catch{}
const release={schema:1,name:'TestPilot',version:JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version,sourceCommit:commit,builtAt:new Date().toISOString(),platform:'win32-'+process.arch,node:process.version,nodeLicenseSource:licenseUrl,runtimeIncluded:true,dependenciesIncluded:true,firstRunDependencyDownload:false,resourceCounts:resourceManifest.counts,resourceManifestSha256:sha(fs.readFileSync(path.join(stage,'project-resources/department-sample/manifest.json'))),historyIncluded:false,credentialsIncluded:false,networkRequiredForBusiness:true};
fs.writeFileSync(path.join(stage,'RELEASE.json'),JSON.stringify(release,null,2)+'\n');
fs.copyFileSync(path.join(repo,'packaging/windows/README.md'),path.join(stage,'README.md'));
function list(directory,prefix=''){return fs.readdirSync(path.join(directory,prefix),{withFileTypes:true}).flatMap(e=>{const relative=prefix?prefix+'/'+e.name:e.name;if(e.isSymbolicLink())throw Error('Linked output: '+relative);return e.isDirectory()?list(directory,relative):[relative];});}
const files=list(stage);
const forbidden=files.filter(f=>/^(?:runtime-data|artifacts|\.local|browser-profiles|test-results|playwright-report)\//.test(f)||/\.(?:sqlite|sqlite3|db|har|log|dump)$/i.test(f)&&!f.startsWith('node_modules/')||/(?:^|\/)\.env(?:\.|$)/.test(f)&&!['.env.example','.env.regression.example'].includes(f));
if(forbidden.length)throw Error('Private or execution files in package: '+forbidden.join(', '));
for(const f of ['启动测试工作台.cmd','停止测试工作台.cmd']){const b=fs.readFileSync(path.join(stage,f)),text=b.toString('latin1');if(b.some(v=>v>127)||/(?<!\r)\n/.test(text))throw Error('CMD encoding must be ASCII and CRLF: '+f);}
const launch=fs.readFileSync(path.join(stage,'packaging/windows/start-workbench.ps1'));if(launch[0]!==239||launch[1]!==187||launch[2]!==191||/(?<!\r)\n/.test(launch.toString('latin1')))throw Error('PowerShell launcher must be UTF-8 BOM and CRLF.');
fs.writeFileSync(path.join(stage,'MANIFEST.sha256'),files.sort().map(f=>sha(fs.readFileSync(path.join(stage,f)))+'  '+f).join('\r\n')+'\r\n');
fs.renameSync(stage,dir);
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',path.join(repo,'scripts/build/archive-windows.ps1'),'-Source',dir,'-Destination',zip],{windowsHide:true,stdio:'inherit'});
fs.writeFileSync(zip+'.sha256',sha(fs.readFileSync(zip))+'  '+path.basename(zip)+'\r\n');
console.log(JSON.stringify({directory:dir,zip,files:files.length+1,bytes:fs.statSync(zip).size,...release},null,2));
