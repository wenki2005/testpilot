import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {buildReportArchive} from '../../dist/adapters/reports/report-archive.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVn0AAAAASUVORK5CYII=','base64'),digest=createHash('sha256').update(png).digest('hex');
const detail=()=>({report:{id:'52000000-0000-4000-8000-000000000001',key:'batch:fixture',kind:'batch',systemId:'52000000-0000-4000-8000-000000000002',systemName:'合成项目',scope:'all',name:'<script>unsafe()</script>',metadata:{name:'',note:'',important:false,revision:0,updatedAt:''},createdAt:'2026-11-06T00:00:00Z',phase:'completed',size:1,groupCount:1,unit:'条',counts:{passed:0,failed:1,blocked:0,error:0,not_executed:0,outside:0},parentBatchId:''},environment:'local',account:'合成账号',profileId:'synthetic',message:'真实断言失败',groups:[{id:'g',title:'样例',version:'v7',size:1,counts:{passed:0,failed:1,blocked:0,error:0,not_executed:0,outside:0},steps:[{id:'one',title:'样例',expected:'期望',actual:'未匹配',status:'failed',caseIds:['one'],evidencePath:'/api/dify-web-modules/jobs/52000000-0000-4000-8000-000000000003/evidence/'+digest+'.png',evidenceNote:'本批次',nextAction:'检查'}]}]});
test('portable archive preserves verdicts, local images, version snapshot and file digests; escapes HTML',async()=>{
 const original=detail(),before=JSON.stringify(original),bytes=await buildReportArchive(original,async()=>png),files=unzipSync(bytes),snapshot=JSON.parse(strFromU8(files['report.json'])),manifest=JSON.parse(strFromU8(files['manifest.json']));
 assert.equal(snapshot.groups[0].steps[0].status,'failed');assert.equal(snapshot.groups[0].version,'v7');assert.equal(snapshot.groups[0].steps[0].evidencePath,'evidence/'+digest+'.png');assert.equal(manifest.missingEvidence.length,0);assert.equal(JSON.stringify(original),before);
 for(const f of manifest.files)assert.equal(createHash('sha256').update(files[f.file]).digest('hex'),f.sha256);
 const html=strFromU8(files['index.html']);assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('src="http'));assert.ok(files['evidence/'+digest+'.png']);
});
test('missing or corrupted screenshots remain explicit without changing outcomes; live runs and foreign paths reject',async()=>{
 const original=detail(),files=unzipSync(await buildReportArchive(original,async()=>{throw Error('missing');})),manifest=JSON.parse(strFromU8(files['manifest.json'])),snapshot=JSON.parse(strFromU8(files['report.json']));assert.equal(manifest.missingEvidence.length,1);assert.equal(snapshot.report.counts.failed,1);assert.equal(snapshot.groups[0].steps[0].evidencePath,'');
 const active=detail();active.report.phase='running';await assert.rejects(()=>buildReportArchive(active,async()=>png),/运行未结束/);const unsafe=detail();unsafe.groups[0].steps[0].evidencePath='https://example.com/private';await assert.rejects(()=>buildReportArchive(unsafe,async()=>png),/无效证据路径/);
});
