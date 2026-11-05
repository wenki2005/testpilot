import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedObservation, compactSourceContext, nodeTestSummary } from '../../dist/adapters/source-tests/agent-evidence.js';

test('large observations keep both failure head and TAP summary tail with explicit omission',()=>{
  const value='failure-head'+'.'.repeat(100000)+'summary-tail';
  const bounded=boundedObservation(value,1000);
  assert.ok(bounded.text.startsWith('failure-head'));
  assert.ok(bounded.text.endsWith('summary-tail'));
  assert.equal(bounded.omittedCharacters,value.length-1000);
  assert.match(bounded.text,/read_evidence/);
});

test('context trimming preserves IDs and call/result order, recent failures and original history',()=>{
  const messages=[{role:'user',content:'original goal',timestamp:0}];
  for(let i=0;i<10;i++){
    messages.push({role:'assistant',content:[{type:'toolCall',id:String(i),name:'read_file',arguments:{}}],timestamp:i});
    messages.push({role:'toolResult',toolCallId:String(i),toolName:'read_file',content:[{type:'text',text:JSON.stringify({evidenceId:'tool-'+i,text:'x'.repeat(10000)})}],timestamp:i,isError:false});
  }
  const before=JSON.stringify(messages),compact=compactSourceContext(messages,1000);
  assert.equal(compact.length,messages.length);
  assert.deepEqual(compact.map(m=>[m.role,m.toolCallId]),messages.map(m=>[m.role,m.toolCallId]));
  assert.ok(JSON.stringify(compact).length<before.length*.65);
  assert.match(compact[2].content[0].text,/tool-0/);
  assert.deepEqual(compact.slice(-4),messages.slice(-4));
  assert.equal(JSON.stringify(messages),before);
});

test('native runner evidence requires actual assertions and keeps skipped or incomplete runs unresolved',()=>{
  assert.equal(nodeTestSummary('# tests 0\n# pass 0\n# fail 0\n',0).status,'blocked');
  assert.equal(nodeTestSummary('# tests 1\n# pass 0\n# fail 0\n# skipped 1\n',0).status,'blocked');
  assert.equal(nodeTestSummary('# tests 1\n# pass 0\n# fail 1\n',1).status,'failed');
  assert.equal(nodeTestSummary('# tests 1\r\n# pass 1\r\n# fail 0\r\n',0).status,'passed');
  assert.equal(nodeTestSummary('# tests 1\n# pass 1\n# fail 0\n',1).status,'blocked');
  assert.equal(nodeTestSummary('plain command output',0).status,'blocked');
});
