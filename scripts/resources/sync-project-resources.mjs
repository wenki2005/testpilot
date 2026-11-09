#!/usr/bin/env node
import path from 'node:path';
import {readResourceDirectory} from '../../dist/adapters/regression/resources/resource-directory.js';
const args=process.argv.slice(2),flags=new Set(['--apply','--allow-edits']),values={};
for(let i=0;i<args.length;i++){const arg=args[i];if(flags.has(arg)){values[arg]=true;continue;}if(!['--dir','--base-url','--base-revision'].includes(arg)||!args[i+1])throw Error('用法：npm run resources:sync -- --dir <资源目录> [--allow-edits] [--apply --base-revision <预览版本>]');values[arg]=args[++i];}
if(!values['--dir'])throw Error('--dir is required.');
const base=new URL(values['--base-url']??'http://127.0.0.1:4323');
if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.search||base.hash)throw Error('Only a local TestPilot endpoint is accepted.');
const {resources,modifiedFiles}=readResourceDirectory(path.resolve(values['--dir']),Boolean(values['--allow-edits']));
async function post(route,body){const r=await fetch(base.href.replace(/\/$/,'')+'/api/system-module-regression/resources/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw Error(data.error??'Resource request failed: '+r.status);return data;}
const preview=await post('preview',resources);
console.log(JSON.stringify({modifiedFiles,...preview},null,2));
if(values['--apply']){if(values['--base-revision']!==preview.revision)throw Error('必须提供与本次预览一致的--base-revision；项目可能已更新，请先检查差异。');console.log(JSON.stringify(await post('apply',{resources,baseRevision:preview.revision}),null,2));}
