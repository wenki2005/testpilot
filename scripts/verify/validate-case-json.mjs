#!/usr/bin/env node
/**
 * 校验外部 Agent 产出的 case JSON：
 * 模块必须存在、动作必须合法、不得写死记录标题、必须有断言、必填字段齐全。
 * 用法：node scripts/verify/validate-case-json.mjs <文件或目录> [...]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = join(root, 'docs/agent/step-schema.json');
const modulesPath = join(root, 'docs/agent/modules.json');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const schema = readJson(schemaPath);
const modules = readJson(modulesPath);
const moduleIds = new Set((modules.modules ?? []).map(item => item.moduleId));
const actions = schema.actions ?? {};
const assertions = new Set(schema.assertions ?? []);
const titlePattern = new RegExp(schema.recordTitlePattern ?? '样书|申请编号|订单号');


const files = [];
const walk = (target) => {
  if (statSync(target).isDirectory()) for (const name of readdirSync(target)) walk(join(target, name));
  else if (target.endsWith('.json')) files.push(target);
};

for (const target of process.argv.slice(2))
  walk(target);
const problems = [];
const check = (file) => {
  const errors = [];
  const doc = readJson(file);
  for (const key of ['caseId', 'title', 'expected', 'moduleId', 'executionRoute', 'steps']) {
    if (doc[key] === undefined || doc[key] === '') errors.push(`缺少字段 ${key}`);
  }
  if (!moduleIds.has(doc.moduleId)) errors.push(`模块不存在：${doc.moduleId}`);
  if (!['browser', 'api', 'blocked'].includes(doc.executionRoute)) errors.push(`执行方式非法：${doc.executionRoute}`);
  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  if (!steps.length) errors.push('步骤为空');
  let asserts = 0;
  steps.forEach((step, index) => {
    const allowed = actions[step.action];
    if (!allowed) { errors.push(`第 ${index + 1} 步动作非法：${step.action}`); return; }
    if (assertions.has(step.action)) asserts++;
    for (const field of allowed) if (step[field] === undefined) errors.push(`第 ${index + 1} 步缺少字段 ${field}`);
    if (step.action === 'clickExactText' && typeof step.text === 'string') {
      if (titlePattern.test(step.text)) errors.push(`第 ${index + 1} 步疑似写死记录标题：${step.text}`);
    }
  });
  if (!asserts) errors.push('缺少断言步骤');
  return errors;
};

if (!files.length) { console.error('没有找到 JSON 文件'); process.exit(2); }
let failed = 0;
for (const file of files) {
  const errors = check(file);
  if (errors.length) { failed++; console.log(`FAIL ${basename(file)}`); for (const error of errors) console.log('  - ' + error); }
  else console.log(`PASS ${basename(file)}`);
}
console.log(`\n${files.length - failed}/${files.length} 通过`);
process.exit(failed ? 1 : 0);
