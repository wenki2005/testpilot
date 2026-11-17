#!/usr/bin/env node
/** 从运行中的工作台导出模块清单，供外部 Agent 归类使用。 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const endpoint = process.env.TESTPILOT_CATALOG_URL ?? 'http://127.0.0.1:4325/dify/api/system-module-regression';
const state = await (await fetch(endpoint)).json();
const modules = [];
for (const module of state.modules ?? []) {
  if (module.archived) continue;
  const version = module.versions?.at(-1);
  const keywords = String(module.name).split(/[与和、\s]+/).filter(word => word.length >= 2);
  modules.push({ moduleId: module.id, name: module.name, versionId: version?.id, caseCount: version?.caseCount, keywords });
}
mkdirSync(join(root, 'docs/agent'), { recursive: true });
const digest = createHash('sha256').update(JSON.stringify(modules.map(item => ({ moduleId: item.moduleId, name: item.name, versionId: item.versionId })).sort((a, b) => a.moduleId.localeCompare(b.moduleId)))).digest('hex');
writeFileSync(join(root, 'docs/agent/modules.json'), JSON.stringify({ generatedAt: new Date().toISOString(), moduleCount: modules.length, digest, modules }, null, 2) + '\n', 'utf8');
console.log(`已导出 ${modules.length} 个模块到 docs/agent/modules.json`);
