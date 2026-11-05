import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeCommand } from '../../dist/adapters/commands/command-adapter.js';

test('actual Pi transport tolerates finely chunked streams and ends immediately after accepted assessment', {timeout:30000}, async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),'testpilot-source-protocol-'));
  const source=path.join(folder,'source'),out=path.join(folder,'runs');
  await mkdir(source);await writeFile(path.join(source,'app.mjs'),'export const value=1;');
  let requests=0;
  const answer={summary:'Local transport fixture only; no business behavior was verified.',findings:[],blockers:[],proposedTests:[]};
  const server=createServer(async(req,res)=>{
    for await(const _ of req) { /* consume request */ }
    requests++;
    const chunks=[];
    const chunk=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:0,model:'fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`;
    chunks.push(chunk({role:'assistant',content:''}));
    // More streaming updates than the former total-event cap, but one model turn.
    for(let i=0;i<11000;i++)chunks.push(chunk({content:'x'}));
    chunks.push(chunk({tool_calls:[{index:0,id:'assessment-call',type:'function',function:{name:'submit_assessment',arguments:JSON.stringify(answer)}}]}));
    chunks.push(chunk({},'tool_calls'));
    chunks.push(`data: ${JSON.stringify({id:'fixture',choices:[],usage:{prompt_tokens:123,completion_tokens:456,total_tokens:579}})}\n\n`);
    chunks.push('data: [DONE]\n\n');
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(chunks.join(''));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const run=await executeCommand({id:'protocol',title:'Pi source agent actual protocol',command:{bin:process.execPath,args:['dist/cli.js','test-agent','--source-root',source,'--goal','Protocol fixture, submit assessment once.','--mode','plan','--timeout-ms','20000','--out',out],cleanEnvironment:true,timeoutMs:25000,env:{TESTPILOT_DATA_DIR:path.join(folder,'data'),TESTPILOT_API_KEY:'local-fixture-key',TESTPILOT_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,TESTPILOT_MODEL:'fixture'}}},path.resolve(import.meta.dirname,'..'));
  assert.equal(run.status,'passed',JSON.stringify(run));
  const ids=await readdir(out);assert.equal(ids.length,1);
  const result=JSON.parse(await readFile(path.join(out,ids[0],'run.json'),'utf8'));
  assert.equal(result.status,'candidate');assert.equal(requests,1);
  assert.equal(result.modelRequests,1);assert.deepEqual(result.usage,{input:123,output:456});
});
