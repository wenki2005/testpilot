import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dataDir=await mkdtemp(join(tmpdir(),'tp-route-release-'));
process.env.TESTPILOT_DATA_DIR=dataDir;
process.env.TESTPILOT_BROWSER_CDP_ENDPOINT='';
process.env.TESTPILOT_BROWSER_HEADLESS='1';
process.env.TESTPILOT_BROWSER_CHANNEL='msedge';
process.env.TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN='0';
process.env.TESTPILOT_API_KEY='';process.env.OPENAI_API_KEY='';
const {executeDocumentRun}=await import('../dist/adapters/document-test-workflow.js');
const {closePersistentTestPages}=await import('../dist/adapters/browser-runtime.js');

test('read-only regression blocks writes while active and releases interception after pass/failure', {timeout:60000},async t=>{
 let writes=0;const server=createServer((req,res)=>{if(req.method==='POST'){writes++;res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;}res.writeHead(200,{'content-type':'text/html'});res.end('<h1>Route cleanup fixture</h1>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await closePersistentTestPages();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(dataDir,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(e=>{if(!['EBUSY','EPERM'].includes(e.code))throw e;});});
 for(const [label,text,status]of[['passed','Route cleanup fixture','passed'],['failed','Absent cleanup fixture','failed']]){
  let page,blocked;
  const project={id:'route-cleanup-'+label,name:'Route cleanup fixture',fileName:'fixture.md',format:'markdown',targetUrl:`http://127.0.0.1:${server.address().port}/`,sourceText:'Local-only routing cleanup fixture',reviewStatus:'approved',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),cases:[{id:'fixture-case',title:'Fixture content',source:'fixture.md:1',requirementRefs:['fixture.md:1'],priority:'P1',category:'functional',confidence:'high',coverageAreas:['functional'],selectedForRegression:true,preconditions:[],preconditionsConfirmed:true,testData:[],sideEffectRisk:'none',cleanup:'',kind:'visible',expected:'The fixture content is visible',steps:[{action:'assertExactVisible',text}]}]};
  const previous=writes;
  const run=await executeDocumentRun(project,{runMode:'regression',selectedCaseIds:['fixture-case'],onCasePrepared:async(_c,p)=>{page=p;blocked=await p.evaluate(()=>fetch('/submit',{method:'POST'}).then(()=>false).catch(()=>true));assert.equal(writes,previous);}});
  assert.equal(run.deterministic.results[0].status,status,run.deterministic.results[0].detail);
  assert.equal(blocked,true,'read-only protection must remain active during the case');
  assert.equal(await page.evaluate(()=>fetch('/submit',{method:'POST'}).then(r=>r.status)),200,'completed run must release interception on the retained user tab');
  assert.equal(writes,previous+1,'only the post-run local fixture write is delivered');
 }
});
