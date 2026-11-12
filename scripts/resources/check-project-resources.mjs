#!/usr/bin/env node
/**
 * 校验 department-sample 用例资源的结构与清单一致性。
 *
 *   node scripts/resources/check-project-resources.mjs            # 只检查
 *   node scripts/resources/check-project-resources.mjs --rebuild   # 重建 manifest 后再检查
 *
 * 检查项：
 *   1. cases 与 scripts 同编号成对
 *   2. 文件名与 JSON 内的 id/caseId 一致
 *   3. case.moduleId 存在于 modules.json
 *   4. modules.json 的 caseKeys 与 cases 目录完全对应
 *   5. manifest.json 的文件清单与 sha256 与磁盘一致
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('project-resources/department-sample');
const rebuild = process.argv.includes('--rebuild');
const errors = [];
const warnings = [];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

if (!existsSync(ROOT)) {
  console.error('缺少资源目录：' + ROOT);
  process.exit(1);
}

const modules = readJson(path.join(ROOT, 'modules.json'));
const moduleById = new Map(modules.map((m) => [m.id, m]));
const caseFiles = walk(path.join(ROOT, 'cases')).filter((f) => f.endsWith('.json'));
const scriptFiles = walk(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.json'));

const caseIds = new Map();
for (const file of caseFiles) {
  const id = path.basename(file, '.json');
  const dir = path.basename(path.dirname(file));
  const data = readJson(file);
  if (data.id !== id) errors.push(`用例编号与文件名不一致：${file}（id=${data.id}）`);
  const mod = moduleById.get(data.moduleId);
  if (!mod) errors.push(`用例 ${id} 的 moduleId 不存在：${data.moduleId}`);
  else if (mod.directory !== dir) errors.push(`用例 ${id} 放在 ${dir}，但模块目录是 ${mod.directory}`);
  caseIds.set(id, { file, dir, moduleId: data.moduleId });
}

for (const file of scriptFiles) {
  const id = path.basename(file, '.json');
  const data = readJson(file);
  if (data.caseId !== id) errors.push(`脚本 caseId 与文件名不一致：${file}（caseId=${data.caseId}）`);
  if (!caseIds.has(id)) errors.push(`脚本没有对应用例：${id}`);
}

for (const id of caseIds.keys()) {
  if (!scriptFiles.some((f) => path.basename(f, '.json') === id)) errors.push(`用例缺少脚本：${id}`);
}

for (const mod of modules) {
  const keys = mod.caseKeys ?? [];
  const ids = new Set(keys.map((k) => k.slice(k.indexOf(':') + 1)));
  for (const key of keys) {
    const [moduleId, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (moduleId !== mod.id) errors.push(`modules.json 中 ${mod.name} 的 caseKey 模块不匹配：${key}`);
    if (!caseIds.has(id)) errors.push(`modules.json 引用了不存在的用例：${id}`);
  }
  const actual = [...caseIds.entries()].filter(([, v]) => v.moduleId === mod.id).map(([id]) => id);
  for (const id of actual) if (!ids.has(id)) errors.push(`modules.json 缺少用例引用：${mod.name} → ${id}`);
  for (const id of ids) if (!actual.includes(id)) errors.push(`modules.json 多出用例引用：${mod.name} → ${id}`);
}

const manifestPath = path.join(ROOT, 'manifest.json');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const actualFiles = walk(ROOT)
  .map(rel)
  .filter((f) => f !== 'manifest.json')
  .sort();

if (rebuild) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.exportedAt = new Date().toISOString();
  manifest.files = actualFiles.map((file) => ({ file, sha256: sha256(path.join(ROOT, file)) }));
  manifest.counts = {
    ...manifest.counts,
    modules: modules.length,
    cases: caseFiles.length,
    scriptsWithSteps: scriptFiles.filter((f) => (readJson(f).steps ?? []).length > 0).length,
    chains: actualFiles.filter((f) => f.startsWith('chains/')).length
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('已重建 manifest.json：' + manifest.files.length + ' 个文件');
} else if (existsSync(manifestPath)) {
  const manifest = readJson(manifestPath);
  const recorded = new Map((manifest.files ?? []).map((f) => [f.file, f.sha256]));
  for (const file of actualFiles) {
    const hash = recorded.get(file);
    if (!hash) errors.push(`manifest 缺少文件：${file}`);
    else if (hash !== sha256(path.join(ROOT, file))) errors.push(`manifest 哈希不一致：${file}`);
  }
  for (const file of recorded.keys()) if (!actualFiles.includes(file)) errors.push(`manifest 多出文件：${file}`);
  for (const [key, value] of Object.entries(manifest.counts ?? {})) {
    const real = key === 'cases' ? caseFiles.length : key === 'modules' ? modules.length : key === 'chains' ? actualFiles.filter((f) => f.startsWith('chains/')).length : null;
    if (real !== null && real !== value) warnings.push(`manifest.counts.${key} = ${value}，实际 ${real}（可用 --rebuild 修正）`);
  }
} else {
  errors.push('缺少 manifest.json');
}

for (const w of warnings) console.warn('警告：' + w);
if (errors.length) {
  for (const e of errors) console.error('错误：' + e);
  console.error(`\n未通过：${errors.length} 个问题`);
  process.exit(1);
}
console.log(`通过：${caseFiles.length} 条用例、${scriptFiles.length} 个脚本、${modules.length} 个模块`);
