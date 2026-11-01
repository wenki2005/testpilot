// Shared helpers for the generated regression script mirror.
// Source of truth is the running TestPilot module registry (module versions in
// the local data directory), never the generated files under regression/scripts.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:4319';
export const DEFAULT_OUT_DIR = 'regression/scripts';
export const GENERATED_NOTE =
  '自动生成，请勿手改。修改用例/步骤后，在 TestPilot 运行状态下执行 npm run scripts:export 重新生成。';

export function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function slugify(value, fallbackId) {
  const raw = String(value ?? '').trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return cleaned || `item-${String(fallbackId ?? '').replace(/-/g, '').slice(0, 8)}`;
}

export function safeCaseFile(caseId) {
  return `${slugify(caseId, caseId)}.json`;
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`);
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status} ${response.statusText}`);
  return response.json();
}

/**
 * Scenario steps (book/list/device/...) are generated at run time and stored in
 * the module store's cachedSteps, not in the imported case's steps. Read that
 * cache so the exported script is the effective one, not an empty placeholder.
 */
export function readCachedSteps(dataDir) {
  const file = path.join(dataDir, 'dify-web-modules', 'records.sqlite');
  if (!existsSync(file)) return new Map();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const cache = new Map();
    for (const row of db.prepare("select id,payload from records where kind='module'").all()) {
      const module = JSON.parse(String(row.payload));
      cache.set(String(row.id), module.cachedSteps ?? {});
    }
    return cache;
  } finally {
    db.close();
  }
}

/**
 * Read every system/module/version/case from the live TestPilot API.
 * Archived modules are included and marked, so the mirror stays complete.
 */
export async function collectRegistry(baseUrl = DEFAULT_BASE_URL, dataDir = 'artifacts/demo') {
  const state = await getJson(baseUrl, '/api/system-module-regression');
  const cache = readCachedSteps(dataDir);
  const systems = [];
  for (const system of state.systems ?? []) {
    const modules = [];
    for (const module of (state.modules ?? []).filter((item) => item.systemId === system.id)) {
      const pack = await getJson(baseUrl, `/api/system-module-regression/modules/${module.id}`);
      const readiness = new Map((pack.readiness ?? []).map((item) => [item.caseId, item]));
      const moduleCache = cache.get(pack.version.id) ?? {};
      modules.push({
        id: module.id,
        name: module.name,
        archived: Boolean(module.archived),
        version: {
          id: pack.version.id,
          version: pack.version.version,
          digest: pack.version.digest,
        },
        cases: (pack.cases ?? []).map((item) => {
          const ready = readiness.get(item.id);
          const storedSteps = Array.isArray(item.steps) ? item.steps : [];
          const cacheEntry = moduleCache[item.id];
          const cachedSteps = Array.isArray(cacheEntry?.steps) ? cacheEntry.steps : [];
          const cacheFresh = Boolean(cacheEntry?.sourceDigest) && cacheEntry.sourceDigest === sha256(item);
          const steps = cacheFresh && cachedSteps.length ? cachedSteps : storedSteps;
          return {
            id: item.id,
            title: item.title,
            priority: item.priority ?? '未记录',
            expected: item.expected,
            source: item.source ?? '',
            modulePath: item.modulePath ?? [],
            steps,
            scriptSource: cacheFresh && cachedSteps.length ? 'cache' : storedSteps.length ? 'stored' : ready?.hasFixedSteps ? 'derived-at-run' : 'none',
            storedStepCount: storedSteps.length,
            cachedStepCount: cachedSteps.length,
            cacheFresh,
            readiness: {
              hasFixedSteps: Boolean(ready?.hasFixedSteps),
              coverageGap: ready?.coverageGap ?? '',
              detail: ready?.detail ?? '',
              nextAction: ready?.nextAction ?? '',
            },
          };
        }),
      });
    }
    systems.push({ id: system.id, name: system.name, modules });
  }
  return { generatedAt: new Date().toISOString(), baseUrl, dataDir, systems };
}

/** Assign stable, collision-free directory/file names and build the generated documents. */
export function buildMirror(registry) {
  const files = new Map();
  const systemIndex = [];
  const usedSystemSlugs = new Map();
  for (const system of registry.systems) {
    let systemSlug = slugify(system.name, system.id);
    const systemKey = systemSlug;
    if (usedSystemSlugs.has(systemKey)) systemSlug = `${systemSlug}-${system.id.slice(0, 8)}`;
    usedSystemSlugs.set(systemKey, system.id);
    const modulesIndex = [];
    const usedModuleSlugs = new Set();
    for (const module of system.modules) {
      let moduleSlug = slugify(module.name, module.id);
      if (usedModuleSlugs.has(moduleSlug)) moduleSlug = `${moduleSlug}-${module.id.slice(0, 8)}`;
      usedModuleSlugs.add(moduleSlug);
      const baseDir = `${systemSlug}/${moduleSlug}`;
      const usedCaseFiles = new Set();
      const casesIndex = [];
      for (const item of module.cases) {
        let fileName = safeCaseFile(item.id);
        const stem = fileName.replace(/\.json$/, '');
        if (usedCaseFiles.has(fileName)) fileName = `${stem}-${sha256(item.id).slice(0, 8)}.json`;
        usedCaseFiles.add(fileName);
        const status = item.steps.length > 0 ? 'fixed' : item.scriptSource === 'derived-at-run' ? 'derived-at-run' : 'no-steps';
        const scriptSource = item.scriptSource ?? (item.steps.length ? 'stored' : 'none');
        const document = {
          schema: 1,
          generated: true,
          note: GENERATED_NOTE,
          system: { id: system.id, name: system.name },
          module: { id: module.id, name: module.name, archived: module.archived },
          version: module.version,
          case: {
            id: item.id,
            title: item.title,
            priority: item.priority,
            expected: item.expected,
            source: item.source,
            modulePath: item.modulePath,
          },
          script: {
            format: 'BrowserStep[]',
            status,
            source: scriptSource,
            storedStepCount: item.storedStepCount ?? item.steps.length,
            cachedStepCount: item.cachedStepCount ?? 0,
            cacheFresh: Boolean(item.cacheFresh),
            stepCount: item.steps.length,
            steps: item.steps,
          },
          readiness: item.readiness,
          caseDigest: sha256({ id: item.id, expected: item.expected, steps: item.steps }),
        };
        files.set(`${baseDir}/${fileName}`, `${JSON.stringify(document, null, 2)}\n`);
        casesIndex.push({
          id: item.id,
          title: item.title,
          priority: item.priority,
          file: fileName,
          status,
          scriptSource,
          stepCount: item.steps.length,
          caseDigest: document.caseDigest,
          coverageGap: item.readiness.coverageGap || undefined,
        });
      }
      const moduleDoc = {
        schema: 1,
        generated: true,
        note: GENERATED_NOTE,
        system: { id: system.id, name: system.name },
        module: { id: module.id, name: module.name, archived: module.archived },
        version: module.version,
        counts: {
          cases: module.cases.length,
          fixed: casesIndex.filter((item) => item.status === 'fixed').length,
          derived: casesIndex.filter((item) => item.status === 'derived-at-run').length,
          noSteps: casesIndex.filter((item) => item.status === 'no-steps').length,
        },
        cases: casesIndex,
      };
      files.set(`${baseDir}/_module.json`, `${JSON.stringify(moduleDoc, null, 2)}\n`);
      modulesIndex.push({
        id: module.id,
        name: module.name,
        archived: module.archived,
        dir: `${systemSlug}/${moduleSlug}`,
        version: module.version,
        counts: moduleDoc.counts,
      });
    }
    files.set(`${systemSlug}/_index.json`, `${JSON.stringify({
      schema: 1,
      generated: true,
      note: GENERATED_NOTE,
      system: { id: system.id, name: system.name },
      modules: modulesIndex,
    }, null, 2)}\n`);
    systemIndex.push({
      id: system.id,
      name: system.name,
      dir: systemSlug,
      modules: modulesIndex.length,
      cases: modulesIndex.reduce((sum, item) => sum + item.counts.cases, 0),
      fixed: modulesIndex.reduce((sum, item) => sum + item.counts.fixed, 0),
      derived: modulesIndex.reduce((sum, item) => sum + item.counts.derived, 0),
      noSteps: modulesIndex.reduce((sum, item) => sum + item.counts.noSteps, 0),
    });
  }
  const index = {
    schema: 1,
    generated: true,
    note: GENERATED_NOTE,
    baseUrl: registry.baseUrl,
    systems: systemIndex,
    totals: {
      systems: systemIndex.length,
      modules: systemIndex.reduce((sum, item) => sum + item.modules, 0),
      cases: systemIndex.reduce((sum, item) => sum + item.cases, 0),
      fixed: systemIndex.reduce((sum, item) => sum + item.fixed, 0),
      derived: systemIndex.reduce((sum, item) => sum + item.derived, 0),
      noSteps: systemIndex.reduce((sum, item) => sum + item.noSteps, 0),
    },
  };
  files.set('_index.json', `${JSON.stringify(index, null, 2)}\n`);
  const lines = [
    '# 生成的回归脚本镜像',
    '',
    GENERATED_NOTE,
    '',
    `- 来源：${registry.baseUrl}`,
    `- 数据目录：${registry.dataDir ?? 'artifacts/demo'}`,
    `- 系统 ${index.totals.systems} / 模块 ${index.totals.modules} / 用例 ${index.totals.cases}`,
    `- 有固定步骤 ${index.totals.fixed}；仅运行期生成 ${index.totals.derived}；无步骤 ${index.totals.noSteps}`,
    '',
    '目录：`<系统>/<模块>/<用例>.json`，每个用例一份 BrowserStep 固定步骤；`_module.json` 和 `_index.json` 是索引。',
    '场景类用例（图书/列表/设备等）的步骤可能由运行期只读场景生成，标记为 `derived-at-run`，并在有缓存时导出缓存步骤。',
    '',
    '校验：`npm run scripts:check`。修改用例请改 TestPilot 模块版本，再重新导出，不要手改本目录。',
    '',
  ];
  files.set('_GENERATED.md', lines.join('\n'));
  return { files, index };
}
