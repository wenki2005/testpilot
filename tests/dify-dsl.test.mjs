import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

// Exercise the actual Python guard shipped to Dify, independent of an LLM.
test('published guard copies immutable source fields and rejects omissions and invented results', () => {
  const dsl = YAML.parse(fs.readFileSync(new URL('../integrations/dify/regression-drafts.yml',import.meta.url),'utf8'));
  const code = dsl.workflow.graph.nodes.find(n => n.data.type === 'code').data.code;
  const source = {baseline_sha256:'a'.repeat(64),cases:[{case_id:'XM-source',title:'old',source_path:['原文','必须拦截'],source_sha256:'a'.repeat(64),source_expected_verbatim:' ✅ 必须拦截！ ',needs_confirmation:['原文待确认']}]};
  const draft={cases:[{case_id:'XM-source',title:'字段校验',preconditions_proposed:['测试身份'],steps_proposed:['观察'],needs_confirmation:['触发方式待确认']}]};
  const bundled=path.join(process.env.USERPROFILE ?? '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python=process.env.TESTPILOT_TEST_PYTHON ?? (fs.existsSync(bundled) ? bundled : process.platform === 'win32' ? 'python' : 'python3');
  const invoke = value => spawnSync(python,['-X','utf8','-c',code+'\nimport sys\np=json.load(sys.stdin)\nprint(json.dumps(main(p["source"],p["draft"]),ensure_ascii=True))'],{input:JSON.stringify({source:JSON.stringify(source),draft:JSON.stringify(value)}),encoding:'utf8'});
  const good=invoke(draft); assert.equal(good.status,0,good.stderr); const output=JSON.parse(JSON.parse(good.stdout).result);
  assert.equal(output.cases[0].expected_result,source.cases[0].source_expected_verbatim); assert.deepEqual(output.cases[0].source_path,source.cases[0].source_path); assert.deepEqual(output.cases[0].needs_confirmation,['原文待确认','触发方式待确认']); assert.equal(output.cases[0].execution_status,'not_executed');
  for(const bad of [{cases:[]},{cases:[draft.cases[0],draft.cases[0]]},{cases:[{...draft.cases[0],expected_result:'放宽'}]},{cases:[{...draft.cases[0],execution_status:'passed'}]}]) assert.notEqual(invoke(bad).status,0);
});

test('fixed execution DSL matches canonical code and independently counts actual results', () => {
  const dsl=YAML.parse(fs.readFileSync(new URL('../integrations/dify/module-execution.yml',import.meta.url),'utf8'));
  const code=fs.readFileSync(new URL('../integrations/dify/module-execution.py',import.meta.url),'utf8');
  assert.equal(dsl.workflow.graph.nodes.find(n=>n.data.type==='code').data.code.replaceAll('\r\n','\n'),code.replaceAll('\r\n','\n'));
  assert.equal(dsl.workflow.graph.nodes.filter(n=>n.data.type==='llm').length,0);
  const bundled=path.join(process.env.USERPROFILE??'','.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python=process.env.TESTPILOT_TEST_PYTHON??(fs.existsSync(bundled)?bundled:process.platform==='win32'?'python':'python3');
  const invoke=data=>spawnSync(python,['-X','utf8','-c',code+'\nimport sys\nprint(json.dumps(main(sys.stdin.read()),ensure_ascii=True))'],{input:JSON.stringify(data),encoding:'utf8'});
  const manifest={schema:1,run_id:'run',module_id:'module',plan_digest:'a'.repeat(64),suite_digest:'b'.repeat(64),case_ids:['one','two']};
  const dispatch=invoke({...manifest,phase:'dispatch'});assert.equal(dispatch.status,0,dispatch.stderr);assert.equal(JSON.parse(JSON.parse(dispatch.stdout).result).action,'execute-approved-suite');
  const report=invoke({...manifest,phase:'report',results:[{case_id:'one',status:'passed'},{case_id:'two',status:'failed'}]});assert.equal(report.status,0,report.stderr);assert.deepEqual(JSON.parse(JSON.parse(report.stdout).result).counts,{passed:1,failed:1,blocked:0,error:0,not_executed:0});
  assert.notEqual(invoke({...manifest,phase:'report',results:[{case_id:'one',status:'passed'}]}).status,0);
});
