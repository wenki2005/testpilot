import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {unzipSync,strFromU8} from 'fflate';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {createDocumentBrowserLaneAdapter} from '../../../dist/adapters/documents/execution/browser-lane.js';
import {createDocumentRunJournalCoordinator} from '../../../dist/application/runs/execution/journal-coordinator.js';
import {launchPersistentTestPage,getExistingPersistentTestPage,closePersistentTestPages} from '../../../dist/adapters/browser/browser-runtime.js';
import {buildDocumentPackageInput} from '../../../dist/adapters/documents/resources/package-builder.js';
import {difyPortableRunner} from '../../../dist/adapters/regression/exports/script-package.js';
import {validateCases,resolveDocumentField,selectDocumentOption,selectDocumentOptionByPlaceholder,selectDocumentOptionByRoleIndex,unsupportedWeChatClientGateMessage} from '../../../dist/adapters/documents/execution/run-executor.js';

test('Dify preparation runs after the incoming baseline reset and supplemental verdict is retained',async t=>{
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end('<h1>Fixture baseline</h1><output id="result">Baseline</output><select><option>Baseline</option></select>');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),events=[];
  const cases=validateCases(['one','two'].map(id=>({id,title:`页面提示文案「Prepared ${id}」`,source:'本地合成用例',expected:`Prepared ${id}`,kind:'visible',sideEffectRisk:'none',steps:[{action:'assertExactVisible',text:`Prepared ${id}`},{action:'assertSelectedByRoleIndex',role:'combobox',index:0,value:`Prepared ${id}`}]})));
  const lane=createDocumentBrowserLaneAdapter({resolveDocumentField,selectDocumentOption,selectDocumentOptionByPlaceholder,selectDocumentOptionByRoleIndex,unsupportedWeChatClientGateMessage});
  const result=await lane(`http://127.0.0.1:${server.address().port}/`,cases,'fixture','integration-project','integration-run',page,undefined,async result=>{
    events.push('result:'+result.id);
    assert.equal(result.status,'passed',result.detail);
    if(result.id==='two'){result.status='blocked';result.detail='Supplemental assertion requires more evidence';result.evidence='fresh-fixture.png';}
  },undefined,undefined,undefined,undefined,undefined,undefined,async(item,currentPage)=>{
    assert.equal(await currentPage.locator('#result').innerText(),'Baseline','each independent case starts fresh');
    events.push('prepared:'+item.id);
    await currentPage.locator('#result').evaluate((el,text)=>{el.textContent=text;},`Prepared ${item.id}`);
    await currentPage.locator('select').evaluate((el,text)=>{el.options[0].textContent=text;},`Prepared ${item.id}`);
  });
  assert.deepEqual(events,['prepared:one','result:one','prepared:two','result:two']);
  assert.equal(result.results[1].status,'blocked');assert.equal(result.results[1].evidence,'fresh-fixture.png');
});

test('journal persists the final supplemental result and its Dify evidence reference',async()=>{
  const journal={runId:'run',resumeCount:0};let saved;
  const coordinator=createDocumentRunJournalCoordinator({journal,saveJournal:async j=>{saved=structuredClone(j);}});
  await coordinator.persistCaseResult('deterministic',{id:'case',title:'fixture',status:'blocked',detail:'Supplemental evidence unavailable',durationMs:1,evidence:'fresh-fixture.png',evidenceNote:'same run'});
  assert.equal(saved.caseResults[0].status,'blocked');assert.equal(saved.caseResults[0].evidence,'fresh-fixture.png');assert.equal(saved.caseResults[0].evidenceNote,'same run');
});

test('incoming portable package retains Dify row removal and selected-control assertions',()=>{
  const item={id:'fixture',title:'fixture',source:'合成测试',expected:'选中值一致',steps:[{action:'deleteSampleRow'},{action:'assertSelectedByRoleIndex',role:'combobox',index:0,value:'合成地区'}]};
  const project={id:'fixture-project',name:'fixture',fileName:'fixture.csv',targetUrl:'http://127.0.0.1:1/',cases:[item]};
  const scope={selectedCaseIds:['fixture'],excludedCaseIds:[],totalCases:1};
  const run={id:'fixture-run',projectId:project.id,report:'fixture',overall:'blocked',deterministic:{results:[]},ai:{results:[]},comparisons:[],caseScope:scope};
  const archive=unzipSync(buildDocumentPackageInput(project,run,scope,[item]));
  const runner=difyPortableRunner(strFromU8(archive['run.mjs']));
  assert.match(runner,/s.action==='deleteSampleRow'/);assert.match(runner,/s.action==='assertSelectedByRoleIndex'/);
  assert.equal(spawnSync(process.execPath,['--check','--input-type=module'],{input:runner,encoding:'utf8',windowsHide:true}).status,0);
});

test('Dify isolated browser ignores global CDP and reuses its own page',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'testpilot-a01-isolation-'));
  const profile=path.join(dir,'document-tests','browser-profiles','isolated-fixture');
  const previous=process.env.TESTPILOT_BROWSER_CDP_ENDPOINT;
  process.env.TESTPILOT_BROWSER_CDP_ENDPOINT='http://127.0.0.1:1';
  process.env.TESTPILOT_BROWSER_HEADLESS='1';process.env.TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN='0';
  try{
    const session=await launchPersistentTestPage(profile,{isolated:true});
    assert.equal((await getExistingPersistentTestPage(profile,{isolated:true}))?.page,session.page);
    assert.equal((await launchPersistentTestPage(profile,{isolated:true})).page,session.page);
    assert.equal(await getExistingPersistentTestPage(profile),undefined);
    assert.equal(session.endpoint,'');
  }finally{
    await closePersistentTestPages();
    if(previous===undefined)delete process.env.TESTPILOT_BROWSER_CDP_ENDPOINT;else process.env.TESTPILOT_BROWSER_CDP_ENDPOINT=previous;
    assert.equal(path.dirname(dir),os.tmpdir());await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
