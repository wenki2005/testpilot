#!/usr/bin/env node
/**
 * 校验外部 Agent 产出的 case JSON：
 * 模块必须存在、动作必须合法、不得写死记录标题、必须有断言、必填字段齐全。
 * 用法：node scripts/verify/validate-case-json.mjs <文件或目录> [...]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
const seenCaseIds = new Map();
const check = (file) => {
  const errors = [];
  const doc = readJson(file);
  const key = String(doc.caseId ?? '');
  if (key) {
    if (seenCaseIds.has(key)) errors.push(`caseId 重复：${key}（另见 ${seenCaseIds.get(key)}）`);
    else seenCaseIds.set(key, basename(file));
  }
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

if (modules.digest) {
  const expected = createHash('sha256').update(JSON.stringify((modules.modules ?? []).map(item => ({ moduleId: item.moduleId, name: item.name, versionId: item.versionId })).sort((a, b) => a.moduleId.localeCompare(b.moduleId)))).digest('hex');
  if (expected !== modules.digest) problems.push('modules.json 内容与 digest 不一致（被手改），请运行 npm run cases:context 重新导出');
}
const catalogUrl = process.env.TESTPILOT_CATALOG_URL ?? 'http://127.0.0.1:4325/dify/api/system-module-regression';
if (modules.digest) {
  try {
    const live = await (await fetch(catalogUrl, { signal: AbortSignal.timeout(3000) })).json();
    const liveModules = (live.modules ?? []).filter(item => !item.archived).map(item => ({ moduleId: item.id, name: item.name, versionId: item.versions?.at(-1)?.id })).sort((a, b) => a.moduleId.localeCompare(b.moduleId));
    const digest = createHash('sha256').update(JSON.stringify(liveModules)).digest('hex');
    if (digest !== modules.digest) problems.push('modules.json 已过期：请先运行 npm run cases:context');
  } catch {
    console.log('提示：无法连接工作台，跳过 modules.json 过期检查');
  }
}
if (!files.length) { console.error('没有找到 JSON 文件'); process.exit(2); }
let failed = 0;
for (const file of files) {
  const errors = check(file);
  if (errors.length) { failed++; console.log(`FAIL ${basename(file)}`); for (const error of errors) console.log('  - ' + error); }
  else console.log(`PASS ${basename(file)}`);
}
for (const problem of problems) { failed++; console.log(`FAIL ${problem}`); }
console.log(`\n${files.length - failed}/${files.length} 通过`);
process.exit(failed ? 1 : 0);
