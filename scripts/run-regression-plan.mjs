#!/usr/bin/env node
// Replay a pinned first-version regression plan. The plan records module version
// IDs and case IDs, so a replay cannot silently pick up a newer case set.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const planPath = arg('plan', process.argv[2]);
const baseUrl = arg('base-url', 'http://127.0.0.1:4319');
const requestId = arg('request-id', randomUUID());
const dryRun = process.argv.includes('--dry-run');

if (!planPath) {
  console.error('用法：node scripts/run-regression-plan.mjs --plan regression/plans/<file>.json [--dry-run] [--base-url http://127.0.0.1:4319]');
  process.exit(2);
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${pathname}`);
  if (!response.ok) throw new Error(`GET ${pathname} -> ${response.status} ${response.statusText}`);
  return response.json();
}

async function main() {
  const plan = JSON.parse(await readFile(path.resolve(planPath), 'utf8'));
  if (plan.schema !== 1 || plan.kind !== 'testpilot-regression-plan') throw new Error('不是 testpilot-regression-plan（schema 1）。');
  if (!Array.isArray(plan.modules) || !plan.modules.length) throw new Error('计划没有 modules。');
  if (plan.runMode !== 'fixed') throw new Error('第一版计划只允许 fixed 固定回归。');

  const state = await getJson('/api/system-module-regression');
  const system = (state.systems ?? []).find((item) => item.id === plan.systemId);
  if (!system) throw new Error(`系统不存在：${plan.systemId}`);

  let selected = 0;
  for (const module of plan.modules) {
    const registryModule = (state.modules ?? []).find((item) => item.id === module.moduleId);
    if (!registryModule) throw new Error(`模块不存在：${module.moduleName} / ${module.moduleId}`);
    if (registryModule.systemId !== plan.systemId) throw new Error(`模块不在系统内：${module.moduleName}`);
    const latest = registryModule.versions.at(-1);
    if (!latest) throw new Error(`模块没有版本：${module.moduleName}`);
    if (latest.id !== module.versionId) throw new Error(`模块 ${module.moduleName} 版本不匹配（计划版本 ID ${module.versionId.slice(0, 8)}，当前 v${latest.version} / ${latest.id.slice(0, 8)}）。请先核对服务地址和数据目录，确认已导入匹配的模块配置；保持原计划，不自动改绑版本或启动测试。`);
    const pack = await getJson(`/api/system-module-regression/modules/${module.moduleId}`);
    const known = new Set((pack.cases ?? []).map((item) => item.id));
    for (const caseId of module.caseIds ?? []) {
      if (!known.has(caseId)) throw new Error(`用例不存在于 ${module.moduleName} v${latest.version}：${caseId}`);
      selected += 1;
    }
    if (!module.caseIds?.length) throw new Error(`模块没有选用例：${module.moduleName}`);
  }

  const body = {
    systemId: plan.systemId,
    moduleIds: plan.modules.map((item) => item.moduleId),
    versionSelections: Object.fromEntries(plan.modules.map((item) => [item.moduleId, item.versionId])),
    caseSelections: Object.fromEntries(plan.modules.map((item) => [item.moduleId, item.caseIds])),
    runMode: 'fixed',
    scope: 'custom',
    requestId,
  };

  const summary = {
    plan: path.relative(process.cwd(), path.resolve(planPath)).replace(/\\/g, '/'),
    name: plan.name,
    system: system.name,
    modules: plan.modules.length,
    cases: selected,
    runMode: 'fixed',
    dryRun,
  };
  if (dryRun) {
    console.log(JSON.stringify({ ...summary, valid: true }, null, 2));
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/system-module-regression/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `创建批次失败：${response.status}`);
  console.log(JSON.stringify({
    ...summary,
    batchId: value.id,
    phase: value.phase,
    url: `${baseUrl.replace(/\/$/, '')}/?page=dify-regression&batch=${value.id}`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
