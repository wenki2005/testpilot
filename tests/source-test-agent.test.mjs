import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSourceTestAgent, loadSourceResume } from '../dist/adapters/source-test-agent.js';
import { executeCommand } from '../dist/adapters/command-adapter.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'testpilot-source-test-'));
  t.after(() => rm(root, { recursive:true, force:true, maxRetries:5, retryDelay:200 }));
  const sourceRoot=path.join(root,'source'), outputRoot=path.join(root,'runs');
  await mkdir(sourceRoot); await writeFile(path.join(sourceRoot,'app.mjs'),'export const max = 999;\n');
  await writeFile(path.join(sourceRoot,'.env'),'TEST_DATABASE_PASSWORD=fixture-secret\n');
  return {sourceRoot,outputRoot,goal:'QTY-001: valid quantities include 1000 and 9999',mode:'generate'};
}
const answer={summary:'Static inspection found an upper bound of 999; run the candidate to verify.',findings:[{caseId:'QTY-001',status:'observed',expected:'9999 allowed',actual:'max=999',evidence:'app.mjs'}],blockers:[],proposedTests:[{id:'QTY-001',title:'Quantity boundary',bin:'node',args:['--test','tests/boundary.test.mjs']}]};
const testCode="import assert from 'node:assert/strict'; import {max} from '../app.mjs'; assert.ok(max >= 9999);\n";
function driver(action){return async context=>{
  const call=async(name,params)=>{
    const tool=context.tools.find(t=>t.name===name);assert.ok(tool,name);
    const result=await tool.execute('fixture-call',params,context.signal);
    return JSON.parse(JSON.parse(result.content[0].text).text);
  };
  await action(call,context);
};}

test('own bounded tools preserve a runnable candidate; independent execution retains a real failure',async t=>{
  const f=await fixture(t);
  const run=await runSourceTestAgent(f,driver(async call=>{
    const listed=await call('list_files',{});assert.deepEqual(listed.files,['app.mjs']);
    assert.match((await call('read_file',{path:'app.mjs'})).text,/999/);
    await call('write_test',{path:'tests/boundary.test.mjs',content:testCode});
    await call('run_tests',{files:['tests/boundary.test.mjs']});
    await call('submit_assessment',answer);
  }));
  assert.equal(run.status,'candidate');assert.match(run.candidateDigest,/^[a-f0-9]{64}$/);
  const command={id:'QTY-001',title:'Boundary',command:{bin:process.execPath,args:['--test','tests/boundary.test.mjs'],cleanEnvironment:true,timeoutMs:10000}};
  assert.equal((await executeCommand(command,run.workspacePath)).status,'failed');
  const candidateBefore=await readFile(path.join(run.workspacePath,'tests/boundary.test.mjs'),'utf8');
  await writeFile(path.join(run.workspacePath,'app.mjs'),'export const max = 9999;\n');
  assert.equal((await executeCommand(command,run.workspacePath)).status,'passed');
  assert.equal(await readFile(path.join(run.workspacePath,'tests/boundary.test.mjs'),'utf8'),candidateBefore);
  assert.equal(await readFile(path.join(f.sourceRoot,'app.mjs'),'utf8'),'export const max = 999;\n');
  assert.doesNotMatch(await readFile(path.join(path.dirname(run.reportPath),'run.json'),'utf8'),/fixture-secret/);
});

test('file tools reject source writes, traversal, existing test replacement and post-submission writes',async t=>{
  const f=await fixture(t);
  const run=await runSourceTestAgent(f,driver(async call=>{
    for(const name of ['app.mjs','../escaped.mjs','tests/../../escaped.mjs','C:/escaped.mjs','tests\\escaped.mjs'])
      await assert.rejects(call('write_test',{path:name,content:'changed'}));
    await call('write_test',{path:'tests/boundary.test.mjs',content:testCode});
    await assert.rejects(call('write_test',{path:'tests/boundary.test.mjs',content:'weakened'}));
    await call('run_tests',{files:['tests/boundary.test.mjs']});
    await call('submit_assessment',answer);
    await assert.rejects(call('write_test',{path:'tests/late.mjs',content:'late'}),/already submitted/);
  }));
  assert.equal(run.status,'candidate');assert.deepEqual(run.changedFiles,['tests/boundary.test.mjs']);
});

test('plan and diagnose cannot write tests; absent and malformed assessments remain blocked',async t=>{
  const f=await fixture(t);
  for(const mode of ['plan','diagnose']){
    const run=await runSourceTestAgent({...f,mode},driver(async call=>{
      await assert.rejects(call('write_test',{path:'tests/new.mjs',content:'x'}),/cannot write/);
      await call('submit_assessment',answer);
    }));assert.equal(run.status,'candidate');assert.deepEqual(run.changedFiles,[]);
  }
  const empty=await runSourceTestAgent(f,driver(async()=>{}));assert.equal(empty.status,'blocked');assert.match(empty.error,/valid assessment/);
  const malformed=await runSourceTestAgent(f,driver(async call=>call('submit_assessment',{summary:'Missing evidence'})));assert.equal(malformed.status,'blocked');
});

test('cancel and time budgets prevent an interrupted turn from becoming a candidate',async t=>{
  const f=await fixture(t);
  const cancelled=await runSourceTestAgent({...f,signal:AbortSignal.abort()},async()=>{throw Error('must not start');});
  assert.equal(cancelled.status,'blocked');assert.match(cancelled.error,/cancelled before/);
  const timeout=await runSourceTestAgent({...f,timeoutMs:1000},async({signal})=>{
    await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });assert.equal(timeout.status,'blocked');assert.match(timeout.error,/budget/);
});

test('tool budget and missing generated files never count as a completed generation',async t=>{
  const f=await fixture(t);
  const budget=await runSourceTestAgent(f,driver(async call=>{for(let i=0;i<41;i++)await call('list_files',{});}));
  assert.equal(budget.status,'blocked');assert.match(budget.error,/tool budget/);
  const empty=await runSourceTestAgent(f,driver(async call=>call('submit_assessment',answer)));
  assert.equal(empty.status,'blocked');assert.match(empty.error,/No new test files/);
});

test('agent consumes a real failure, investigates source, adds a second test and executes again',async t=>{
  const f=await fixture(t);
  const run=await runSourceTestAgent(f,driver(async call=>{
    await call('write_test',{path:'tests/boundary.test.mjs',content:testCode});
    const first=await call('run_tests',{files:['tests/boundary.test.mjs']});
    assert.equal(first.status,'failed');assert.equal(first.counts.fail,1);
    const cached=await call('run_tests',{files:['tests/boundary.test.mjs']});assert.equal(cached.cached,true);assert.equal(cached.executionId,first.executionId);
    assert.match((await call('search_source',{query:'999'})).matches,/app.mjs.*999/);
    const evidence=await call('read_evidence',{evidenceId:'execution-1'});
    assert.match(evidence.text,/AssertionError/);
    await call('write_test',{path:'tests/independent.test.mjs',content:"import test from 'node:test';import assert from 'node:assert/strict';import {max} from '../app.mjs';test('max is integer',()=>assert.ok(Number.isInteger(max)));"});
    await assert.rejects(call('submit_assessment',answer),/all generated/);
    const second=await call('run_tests',{files:['tests/boundary.test.mjs','tests/independent.test.mjs']});
    assert.equal(second.status,'failed');assert.equal(second.counts.tests,2);
    await call('submit_assessment',{...answer,findings:[{...answer.findings[0],status:'failed',evidence:'tool-2: actual assertion failure'}]});
  }));
  assert.equal(run.status,'candidate');assert.equal(run.runtimeStatus,'failed');
  assert.equal(run.commandCount,2);assert.equal(run.successfulCommands,0);
  assert.equal(run.executions.length,2);
  const events=await readFile(path.join(path.dirname(run.reportPath),'events.jsonl'),'utf8');
  assert.match(events,/search_source/);assert.match(events,/run_tests/);
});

test('runtime source tampering blocks the run and retains execution evidence',async t=>{
  const f=await fixture(t);
  const run=await runSourceTestAgent(f,driver(async call=>{
    await call('write_test',{path:'tests/tamper.test.mjs',content:"import fs from 'node:fs';fs.writeFileSync('app.mjs','export const max = 9999;');"});
    await call('run_tests',{files:['tests/tamper.test.mjs']});
  }));
  assert.equal(run.status,'blocked');assert.match(run.error,/protected files/);
  assert.deepEqual(run.protectedChanges,['app.mjs']);
  assert.match(await readFile(path.join(path.dirname(run.reportPath),'execution-1.json'),'utf8'),/exit_code/);
  assert.equal(await readFile(path.join(f.sourceRoot,'app.mjs'),'utf8'),'export const max = 999;\n');
});

test('static findings cannot be upgraded to confirmed failure without runtime evidence',async t=>{
  const f=await fixture(t);
  const run=await runSourceTestAgent({...f,mode:'diagnose'},driver(async call=>{
    await call('submit_assessment',{...answer,findings:[{...answer.findings[0],status:'failed'}]});
  }));
  assert.equal(run.status,'blocked');assert.match(run.error,/runtime failure evidence/);
});

test('candidate-only repair keeps before/after evidence, requires rerun and resumes the owned workspace',async t=>{
  const f=await fixture(t);
  await mkdir(path.join(f.sourceRoot,'tests'));
  await writeFile(path.join(f.sourceRoot,'tests/math.test.mjs'),"import assert from 'node:assert/strict';assert.equal(1+5,5);");
  const run=await runSourceTestAgent({...f,candidateFiles:['tests/math.test.mjs']},driver(async call=>{
    assert.equal((await call('run_tests',{files:['tests/math.test.mjs']})).status,'failed');
    await assert.rejects(call('revise_test',{path:'app.mjs',content:'x',reason:'Fix observed arithmetic in generated test',requirementRef:'UI-001'}),/Only this agent/);
    await assert.rejects(call('revise_test',{path:'tests/math.test.mjs',content:"test.skip('wrong',()=>{});",reason:'Skip observed arithmetic in generated test',requirementRef:'UI-001'}),/cannot skip/);
    await call('revise_test',{path:'tests/math.test.mjs',content:"import assert from 'node:assert/strict';assert.equal(1+5,6);",reason:'The documented initial value is 1; five increments yield 6, not 5.',requirementRef:'UI-001 initial=1, each click adds one'});
    await assert.rejects(call('submit_assessment',answer),/all generated/);
    assert.equal((await call('run_tests',{files:['tests/math.test.mjs']})).status,'passed');
    await call('submit_assessment',answer);
  }));
  assert.equal(run.status,'candidate');assert.equal(run.runtimeStatus,'passed');
  assert.equal(run.commandCount,2);assert.deepEqual(run.changedFiles,['tests/math.test.mjs']);
  const folder=path.dirname(run.reportPath);
  const files=await (await import('node:fs/promises')).readdir(folder);
  const revision=JSON.parse(await readFile(path.join(folder,files.find(f=>/^revision-/.test(f))),'utf8'));
  assert.match(revision.before,/1\+5,5/);assert.match(revision.after,/1\+5,6/);
  const resumed=await loadSourceResume(path.join(folder,'run.json'));
  assert.equal(resumed.sourceRoot,run.workspacePath);assert.equal(resumed.goal,f.goal);
  assert.deepEqual(resumed.candidateFiles,['tests/math.test.mjs']);
  assert.match(await readFile(path.join(f.sourceRoot,'tests/math.test.mjs'),'utf8'),/1\+5,5/);
});
