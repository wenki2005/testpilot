import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlaywrightReport } from '../dist/adapters/playwright-test-adapter.js';

const sample=(tests,errors=[])=>({suites:[{title:'fixture',specs:tests.map((item,i)=>({id:String(i),title:'case-'+i,tests:[item]}))}],errors});
test('upstream retries, skipped tests and expected failures are never silently green',()=>{
  const pass={status:'expected',expectedStatus:'passed',projectName:'pc',results:[{status:'passed'}]};
  assert.equal(normalizePlaywrightReport(sample([pass])).status,'passed');
  assert.equal(normalizePlaywrightReport(sample([{...pass,status:'flaky',results:[{status:'failed'},{status:'passed'}]}])).status,'blocked');
  assert.equal(normalizePlaywrightReport(sample([{...pass,status:'skipped',expectedStatus:'skipped',results:[]}])).status,'blocked');
  assert.equal(normalizePlaywrightReport(sample([{...pass,expectedStatus:'failed',results:[{status:'failed'}]}])).status,'blocked');
  assert.equal(normalizePlaywrightReport(sample([{...pass,status:'unexpected',results:[{status:'failed'}]}])).status,'failed');
  assert.equal(normalizePlaywrightReport(sample([pass],[{message:'teardown failed'}])).status,'failed');
  assert.equal(normalizePlaywrightReport(sample([])).status,'blocked');
  assert.throws(()=>normalizePlaywrightReport({}),/Invalid/);
});
