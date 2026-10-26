import { createHash } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import { redactSensitiveExportData, redactSensitiveExportText } from "./document-sensitive-data.js";

type PackageProject = {
  id: string;
  name: string;
  fileName: string;
  targetUrl: string;
  caseMode?: string;
  workflowPlan?: string[];
  sourceRoles?: Array<{ fileName: string; role: "requirements" | "coverage-reference" | "held-out-benchmark" | "website-content" }>;
  sourceMaterials?: Array<{ id: string; fileName: string; role: string; sha256: string; byteLength: number; createdAt: string }>;
  researchExamples?: Array<{ title: string; url: string; snippet: string }>;
  caseGeneration?: { artifactId: string; version: number; generatedAt: string; digest: string; requirements: unknown[]; qualitySummary: Record<string, unknown>; warnings: string[]; sources: unknown[]; transferredCases: unknown[] };
  cases: Array<{ id: string; [key: string]: unknown }>;
};

type PackageRun = {
  id: string;
  projectId: string;
  siteVersionSnapshot?: { id: string; label: string; environment: string; targetUrl: string; changeNotes: string; createdAt: string };
  caseVersion?: string;
  materialVersion?: string;
  sourceMaterialsSnapshot?: Array<{ id: string; fileName: string; role: string; sha256: string; byteLength: number; createdAt: string }>;
  testDataSetId?: string;
  testDataVersion?: string;
  baselineRunId?: string;
  baselineRunSnapshot?: {
    runId: string;
    startedAt: string;
    completedAt: string;
    runMode?: string;
    siteVersionSnapshot?: { label: string; environment: string };
    caseVersion?: string;
    materialVersion?: string;
    testDataVersion?: string;
    scopePlan?: { mode: string; targetCaseIds: string[]; impactCaseIds: string[] };
    selectedCaseCount: number;
    totalCases: number;
  };
  baselineEnvironmentComparison?: "same" | "different" | "unknown";
  baselineRunModeComparison?: "same" | "different" | "unknown";
  baselineMaterialChanged?: boolean;
  baselineTestDataChanged?: boolean;
  parameterValues?: Record<string, string>;
  scopePlan?: { mode: string; targetCaseIds: string[]; impactCaseIds: string[]; impactReasons?: Record<string, string[]> };
  startedAt: string;
  completedAt: string;
  caseScope: { selectedCaseIds: string[]; excludedCaseIds: string[]; totalCases: number };
  caseSnapshotVersion?: 1;
  caseSnapshots?: Array<{ id: string; [key: string]: unknown }>;
  executionCaseSnapshots?: Array<{ id: string; [key: string]: unknown }>;
  deterministic: unknown;
  ai: unknown;
  comparisons: Array<{ id: string }>;
  report: string;
  overall: string;
  finalReady: boolean;
  recovery?: unknown;
  stepGeneration?: unknown;
  analysis?: string;
  /** Preserve forward-compatible run fields such as caseGeneration and retest lineage. */
  [key: string]: unknown;
};

type ArtifactSource = {
  kind: string;
  id?: string;
  field?: string;
  reference?: string;
  digest?: string;
};

type PackageArtifact = {
  bytes: Uint8Array;
  mediaType: string;
  artifactType: string;
  sources: ArtifactSource[];
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Rebuilds package data from the saved project and run record. Only runner code is reused. */
export function refreshDocumentPackage(project: PackageProject, run: PackageRun, previousPackage: Uint8Array): Uint8Array {
  if (project.id !== run.projectId) throw new Error("Project and authoritative run do not match.");
  if (!run.id || !run.report || !run.deterministic || !run.ai || !Array.isArray(run.comparisons) || !run.caseScope) throw new Error("Authoritative run evidence is incomplete.");
  const ids = project.cases.map(item => item.id);
  if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new Error("Current project has missing or duplicate case IDs.");
  const archive = unzipSync(previousPackage);
  if (!archive["run.mjs"]) throw new Error("Previous package does not contain a reusable runner.");
  let reusableRunner = new TextDecoder().decode(archive["run.mjs"]);
  // Earlier TestPilot ZIPs were produced by a fragile string-replacement
  // pipeline. One replacement inserted the step loop before the later network
  // observer patch, so assertNoFetchOrXhr was silently absent from run.mjs.
  // Refresh the existing loop in place and bring the disabled-submit preflight
  // into parity with the live runner, without changing historical run results.
  if (reusableRunner.includes("let capturedUrl;for(const s of c.steps??[])") && !reusableRunner.includes("Unexpected fetch/XHR count")) {
    reusableRunner = reusableRunner.replace(
      "await page.goto(suite.targetUrl,{waitUntil:'domcontentloaded'});let capturedUrl;for(const s of c.steps??[]){",
      "await page.goto(suite.targetUrl,{waitUntil:'domcontentloaded'});let captureFetchOrXhr=false;const observedFetchOrXhr=[];page.on('request',r=>{if(captureFetchOrXhr&&['fetch','xhr'].includes(r.resourceType()))observedFetchOrXhr.push(r.method()+' '+r.resourceType())});let capturedUrl;for(const s of c.steps??[]){if(s.action==='startFetchOrXhrCapture'){observedFetchOrXhr.length=0;captureFetchOrXhr=true;}else if(s.action==='assertNoFetchOrXhr'){if(!captureFetchOrXhr)throw Error('Network capture was not started');await page.waitForTimeout(s.quietMs??1000);captureFetchOrXhr=false;if(observedFetchOrXhr.length)throw Error('Unexpected fetch/XHR count: '+observedFetchOrXhr.length+' (methods and types only)');}"
    );
  }
  if (reusableRunner.includes("blockAllValidationRequests=true;try{await el.click") && !reusableRunner.includes("submit button disabled; valid synthetic fixtures required")) {
    reusableRunner = reusableRunner.replace(
      "blockAllValidationRequests=true;try{await el.click",
      "const disabled=await el.evaluate(n=>{let p=n;for(let d=0;d<5&&p;p=p.parentElement,d++){if(!(p instanceof HTMLButtonElement||p instanceof HTMLInputElement||p.matches('[role=button],[class*=btn],[class*=button]')))continue;const c=typeof p.className==='string'?p.className:'';return ((p instanceof HTMLButtonElement||p instanceof HTMLInputElement)&&p.disabled)||p.getAttribute('aria-disabled')==='true'||/disabled/i.test(c)||getComputedStyle(p).pointerEvents==='none'}return false});if(disabled)throw Error('Blocked: submit button disabled; valid synthetic fixtures required for all other mandatory fields');blockAllValidationRequests=true;try{await el.click"
    );
  }
  reusableRunner = reusableRunner.replace("/(?:^|\\\\s)(?:is-)?disabled(?:\\\\s|$)/i.test(c)", "/disabled/i.test(c)");
  reusableRunner = reusableRunner.replace(
    "for(const c of suite.cases){",
    "for(const c of suite.cases.filter(c=>!Array.isArray(suite.selectedCaseIds)||suite.selectedCaseIds.includes(c.id))){",
  );
  const targetNavigation = "await page.goto(suite.targetUrl,{waitUntil:'domcontentloaded'});";
  const caseEntryNavigation = String.raw`const baseTargetUrl=new URL(suite.targetUrl);if(c.entryPath!==undefined&&c.entryPath!==''&&(typeof c.entryPath!=='string'||!c.entryPath.startsWith('/')||c.entryPath.startsWith('//')||c.entryPath.includes('\\')||/[\u0000-\u001f\u007f]/u.test(c.entryPath)))throw Error('Blocked: case entry path must be a same-origin path');if(c.entryPath&&c.entryPath.split(/[?&;]/u).slice(1).some(pair=>{const rawKey=pair.split('=',1)[0]??'';let key=rawKey;try{key=decodeURIComponent(rawKey.replace(/\+/gu,' '))}catch{}return /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key|client[_-]?secret|authorization|password|passwd|secret|token)$/iu.test(key.trim())}))throw Error('Blocked: credentials are not allowed in a case entry path');const caseTargetUrl=new URL(c.entryPath||baseTargetUrl.href,baseTargetUrl);if(caseTargetUrl.origin!==baseTargetUrl.origin||caseTargetUrl.username||caseTargetUrl.password)throw Error('Blocked: case entry path must stay on the target origin');const environmentQuery=new URLSearchParams(baseTargetUrl.search),entryQuery=new URLSearchParams(caseTargetUrl.search);for(const key of new Set(entryQuery.keys())){const values=entryQuery.getAll(key);if(environmentQuery.has(key)){const existing=environmentQuery.getAll(key);if(values.some(value=>!existing.includes(value)))throw Error('Blocked: case entry path cannot override site version parameter '+key)}else for(const value of values)environmentQuery.append(key,value)}caseTargetUrl.search=environmentQuery.toString();await page.goto(caseTargetUrl.href,{waitUntil:'domcontentloaded'});`;
  if (reusableRunner.includes(targetNavigation)) reusableRunner = reusableRunner.replaceAll(targetNavigation, caseEntryNavigation);

  const currentSet = new Set(ids);
  const selectedIds = run.caseScope.selectedCaseIds;
  const excludedIds = run.caseScope.excludedCaseIds;
  const comparisonIds = new Set(run.comparisons.map(item => item.id));
  const refreshedAt = new Date().toISOString();
  const runTargetUrl = run.siteVersionSnapshot?.targetUrl ?? project.targetUrl;
  const parameterValues = run.parameterValues && typeof run.parameterValues === "object" && !Array.isArray(run.parameterValues) ? run.parameterValues as Record<string, string> : {};
  const parameterToken = /\{\{param:([A-Za-z][A-Za-z0-9_.-]{0,39})\}\}/gu;
  const parameterFields = new Set(["value", "text", "name"]);
  const selectedSetForParameters = new Set(selectedIds);
  let caseSnapshotSource: "run-snapshot" | "previous-package-snapshot" | "current-project-legacy-fallback";
  let snapshotCases: Array<{ id: string; [key: string]: unknown }>;
  let caseSnapshots: Array<{ id: string; [key: string]: unknown }> | undefined;
  let executionCaseSnapshots: Array<{ id: string; [key: string]: unknown }> | undefined;
  if (run.caseSnapshotVersion === 1) {
    if (!Array.isArray(run.caseSnapshots) || !Array.isArray(run.executionCaseSnapshots)) throw new Error("Versioned run is missing its immutable case snapshots.");
    caseSnapshots = run.caseSnapshots;
    executionCaseSnapshots = run.executionCaseSnapshots;
    const snapshotIds = caseSnapshots.map(item => item?.id);
    const executionIds = executionCaseSnapshots.map(item => item?.id);
    if (snapshotIds.some(id => typeof id !== "string" || !id) || new Set(snapshotIds).size !== snapshotIds.length) throw new Error("Run case snapshot contains missing or duplicate case IDs.");
    if (new Set(executionIds).size !== executionIds.length || selectedIds.length !== executionIds.length || selectedIds.some(id => !executionIds.includes(id))) throw new Error("Executed case snapshots do not exactly match the fixed run scope.");
    if (run.caseScope.totalCases !== caseSnapshots.length || selectedIds.some(id => !snapshotIds.includes(id)) || excludedIds.some(id => !snapshotIds.includes(id))) throw new Error("Run scope does not match its immutable case snapshots.");
    const executionById = new Map(executionCaseSnapshots.map(item => [item.id, item]));
    snapshotCases = caseSnapshots.map(item => selectedSetForParameters.has(item.id) ? executionById.get(item.id)! : item);
    caseSnapshotSource = "run-snapshot";
  } else {
    let previousCaseSnapshot: { cases?: Array<{ id: string; [key: string]: unknown }>; selectedCaseIds?: string[]; excludedCaseIds?: string[]; totalCases?: number } | undefined;
    try { previousCaseSnapshot = JSON.parse(new TextDecoder().decode(archive["cases.json"])) as typeof previousCaseSnapshot; } catch { /* legacy package did not contain readable cases.json */ }
    const previousIds = previousCaseSnapshot?.cases?.map(item => item?.id);
    const previousMatchesScope = Array.isArray(previousIds)
      && new Set(previousIds).size === previousIds.length
      && selectedIds.every(id => previousIds.includes(id))
      && excludedIds.every(id => previousIds.includes(id))
      && (previousCaseSnapshot?.totalCases === undefined || previousCaseSnapshot.totalCases === run.caseScope.totalCases);
    if (previousMatchesScope) {
      caseSnapshotSource = "previous-package-snapshot";
      snapshotCases = previousCaseSnapshot!.cases!;
    } else {
      caseSnapshotSource = "current-project-legacy-fallback";
      snapshotCases = project.cases;
    }
    const snapshotIds = snapshotCases.map(item => item.id);
    if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !snapshotIds.includes(id))) throw new Error("Legacy run scope cannot be recovered from its saved package or current project.");
    if (new Set(excludedIds).size !== excludedIds.length || excludedIds.some(id => !snapshotIds.includes(id)) || selectedIds.some(id => excludedIds.includes(id))) throw new Error("Legacy run scope contains duplicate, unknown, or overlapping excluded case IDs.");
    if (caseSnapshotSource === "current-project-legacy-fallback") {
      snapshotCases = snapshotCases.map(item => {
        if (!selectedSetForParameters.has(item.id)) return item;
        return {
          ...item,
          steps: (Array.isArray(item.steps) ? item.steps as Array<Record<string, unknown>> : []).map(step => {
            const resolved: Record<string, unknown> = { ...step };
            for (const [key, value] of Object.entries(resolved)) {
              if (!parameterFields.has(key) || typeof value !== "string") continue;
              parameterToken.lastIndex = 0;
              resolved[key] = value.replace(parameterToken, (_token, name: string) => parameterValues[name] ?? "{{param:" + name + "}}");
            }
            return resolved;
          }),
        };
      });
    }
  }
  const snapshotIds = snapshotCases.map(item => item.id);
  if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !snapshotIds.includes(id))) throw new Error("Run scope contains duplicate or unknown selected case IDs.");
  if (new Set(excludedIds).size !== excludedIds.length || excludedIds.some(id => !snapshotIds.includes(id)) || selectedIds.some(id => excludedIds.includes(id))) throw new Error("Run scope contains duplicate, unknown, or overlapping excluded case IDs.");
  const markdownLabel = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/`/g, "\\`").replace(/\|/g, "\\|");
  const caseTitle = (id: string) => {
    const item = snapshotCases.find(candidate => candidate.id === id);
    return typeof item?.title === "string" && item.title.trim() ? item.title.trim() : id;
  };
  const caseLabel = (id: string) => `${markdownLabel(caseTitle(id))}（${markdownLabel(id)}）`;
  const scopeReadme = run.scopePlan
    ? [
      `\n本轮范围类型：${markdownLabel(run.scopePlan.mode)}。`,
      `直接测试目标：${run.scopePlan.targetCaseIds.map(caseLabel).join("；") || "无"}。`,
      `关联影响检查：${run.scopePlan.impactCaseIds.map(caseLabel).join("；") || "无"}。`,
      ...run.scopePlan.impactCaseIds.flatMap(id => {
        const reasons = run.scopePlan?.impactReasons?.[id];
        return [`影响依据 · ${markdownLabel(id)}：${reasons?.length ? `${reasons.map(markdownLabel).join("；")}。` : "未记录具体关系依据。"}`];
      }),
      `本轮未选、因此未验证的用例：${excludedIds.map(caseLabel).join("；") || "无"}。`,
    ].join("\n")
    : "\n本轮范围类型和目标/影响分类未记录（历史运行）。请以 report.md 中的实际执行结果为准。";
  const baselineCaseLabel = (id: string) => `\`${markdownLabel(id)}\``;
  const baselineScope = run.baselineRunSnapshot?.scopePlan
    ? `基线范围：${markdownLabel(run.baselineRunSnapshot.scopePlan.mode)}；直接目标 ${run.baselineRunSnapshot.scopePlan.targetCaseIds.map(baselineCaseLabel).join("、") || "无"}；关联影响 ${run.baselineRunSnapshot.scopePlan.impactCaseIds.map(baselineCaseLabel).join("、") || "无"}。`
    : run.baselineRunId ? "基线范围：旧版记录未标注。" : "基线范围：未选择历史基线。";
  const baselineSiteVersion = run.baselineRunSnapshot?.siteVersionSnapshot
    ? ` · ${markdownLabel(run.baselineRunSnapshot.siteVersionSnapshot.environment)} · ${markdownLabel(run.baselineRunSnapshot.siteVersionSnapshot.label)}`
    : run.baselineRunId ? " · 未登记网站版本" : "";
  const baselineComparisonNotes = [
    run.baselineRunId && !run.baselineRunSnapshot ? "所选历史基线未留存详细版本快照，部分版本关系无法判定" : undefined,
    run.baselineEnvironmentComparison === "different" ? "基线环境或目标站点来源不同，结果变化不能单独归因于版本迭代" : run.baselineEnvironmentComparison === "unknown" ? "至少一轮没有有效的环境或目标站点来源记录，无法确认环境一致" : undefined,
    run.baselineRunModeComparison === "different" ? "两轮使用了不同的验证方式" : run.baselineRunModeComparison === "unknown" ? "至少一轮没有验证方式记录" : undefined,
    run.baselineMaterialChanged === true ? "需求或测试资料版本发生变化" : undefined,
    run.baselineRunSnapshot && (!run.materialVersion || !run.baselineRunSnapshot.materialVersion) ? "本轮或基线缺少需求/测试资料版本，无法确认资料是否一致" : undefined,
    run.baselineTestDataChanged === true ? "测试数据版本发生变化" : undefined,
    run.baselineRunSnapshot && (!run.testDataVersion || !run.baselineRunSnapshot.testDataVersion) ? "本轮或基线缺少测试数据版本，无法确认数据是否一致" : undefined,
  ].filter((note): note is string => Boolean(note));
  const baselineRunCount = run.baselineRunSnapshot ? `；该基线执行 ${run.baselineRunSnapshot.selectedCaseCount}/${run.baselineRunSnapshot.totalCases} 条` : "";
  const baselineVersionDetails = run.baselineRunSnapshot
    ? `\n基线用例/脚本版本：${markdownLabel(run.baselineRunSnapshot.caseVersion ?? "历史运行未记录")}；需求/测试资料版本：${markdownLabel(run.baselineRunSnapshot.materialVersion ?? "历史运行未记录")}；测试数据版本：${markdownLabel(run.baselineRunSnapshot.testDataVersion ?? "历史运行未记录")}。`
    : "";
  const baselineReadme = `\n\n本轮历史基线：${run.baselineRunId ? `\`${markdownLabel(run.baselineRunId)}\`${baselineSiteVersion}${baselineRunCount}` : "未选择"}。${baselineScope}${baselineVersionDetails}${baselineComparisonNotes.length ? `\n基线比较提示：${baselineComparisonNotes.join("；")}。` : ""}`;
  const currentCases = JSON.stringify({
    targetUrl: runTargetUrl,
    ...(run.siteVersionSnapshot ? { siteVersionSnapshot: run.siteVersionSnapshot } : {}),
    ...(run.caseVersion ? { caseVersion: run.caseVersion } : {}),
    ...(run.materialVersion ? { materialVersion: run.materialVersion } : {}),
    ...(run.testDataSetId ? { testDataSetId: run.testDataSetId } : {}),
    ...(run.testDataVersion ? { testDataVersion: run.testDataVersion } : {}),
    caseMode: project.caseMode ?? "both",
    caseSnapshotSource,
    cases: snapshotCases,
    ...(caseSnapshots ? { caseSnapshots } : {}),
    ...(executionCaseSnapshots ? { executionCaseSnapshots } : {}),
    selectedCaseIds: selectedIds,
    excludedCaseIds: excludedIds,
    ...(run.scopePlan ? { scopePlan: run.scopePlan } : {}),
    totalCases: snapshotCases.length,
  }, null, 2);
  const runEvidence = {
    ...run,
    ...(!run.caseGeneration && project.caseGeneration ? {
      caseGeneration: {
        artifactId: project.caseGeneration.artifactId,
        version: project.caseGeneration.version,
        digest: project.caseGeneration.digest,
      },
    } : {}),
    id: run.id, projectId: run.projectId, startedAt: run.startedAt, completedAt: run.completedAt,
    recovery: run.recovery, stepGeneration: run.stepGeneration, overall: run.overall,
    finalReady: run.finalReady, deterministic: run.deterministic, ai: run.ai,
    comparisons: run.comparisons, analysis: run.analysis, caseScope: run.caseScope,
  };
  const currentCasesBytes = strToU8(currentCases);
  const previousPackageSha256 = sha256(previousPackage);
  const workflowPlanPresent = project.workflowPlan !== undefined;
  const researchExamplesPresent = project.researchExamples !== undefined;
  const artifacts: Record<string, PackageArtifact> = {
    "README.md": {
      bytes: strToU8(`# ${markdownLabel(project.name)} · TestPilot 回归包\n\n需求来源：${markdownLabel(project.fileName)}\n目标：${markdownLabel(runTargetUrl)}\n${run.siteVersionSnapshot ? `网站版本：${markdownLabel(run.siteVersionSnapshot.environment)} · ${markdownLabel(run.siteVersionSnapshot.label)}\n迭代说明：${markdownLabel(run.siteVersionSnapshot.changeNotes || "未填写")}\n` : "网站版本：未登记\n"}用例/脚本版本：${markdownLabel(run.caseVersion ?? "历史运行未记录")}\n需求/测试资料版本：${markdownLabel(run.materialVersion ?? "历史运行未记录")}\n测试数据版本：${markdownLabel(run.testDataVersion ?? "历史运行未记录")}\n\n本包的 cases.json 来源：${caseSnapshotSource}。新运行保留运行时完整用例快照和参数化后的实际执行快照；旧运行若缺少快照则尽量从已保存 ZIP 恢复，无法恢复时会明确标记使用当前项目兼容数据。脚本只包含本轮选中的用例并按 selectedCaseIds 执行：${selectedIds.join(", ") || "无"}；未选用例：${excludedIds.join(", ") || "无"}。${scopeReadme}${baselineReadme}\n\nrun.json 和 report.md 是关联运行的原始权威证据；refresh.json 标明运行快照与当前用例集的差异。`),
      mediaType: "text/markdown; charset=utf-8", artifactType: "package-readme",
      sources: caseSnapshotSource === "run-snapshot" || caseSnapshotSource === "previous-package-snapshot" ? [{ kind: "run", id: run.id, field: "caseSnapshots" }] : [{ kind: "project", id: project.id, field: "cases", reference: project.fileName }, { kind: "run", id: run.id }],
    },
    "workflow-plan.json": {
      bytes: strToU8(JSON.stringify(project.workflowPlan ?? [], null, 2)),
      mediaType: "application/json", artifactType: workflowPlanPresent ? "workflow-plan" : "empty-workflow-plan",
      sources: [{ kind: "project", id: project.id, field: "workflowPlan" }],
    },
    "source-roles.json": {
      bytes: strToU8(JSON.stringify(project.sourceRoles ?? [], null, 2)),
      mediaType: "application/json", artifactType: project.sourceRoles ? "input-source-roles" : "legacy-source-roles-unrecorded",
      sources: [{ kind: "project", id: project.id, field: "sourceRoles" }],
    },
    "source-materials.json": {
      bytes: strToU8(JSON.stringify(run.sourceMaterialsSnapshot ?? project.sourceMaterials ?? [], null, 2)),
      mediaType: "application/json", artifactType: run.sourceMaterialsSnapshot?.length || project.sourceMaterials?.length ? "run-source-material-snapshot" : "legacy-source-materials-unrecorded",
      sources: [{ kind: "run", id: run.id, field: "sourceMaterialsSnapshot" }, { kind: "project", id: project.id, field: "sourceMaterials" }],
    },
    "research-examples.json": {
      bytes: strToU8(JSON.stringify({ results: project.researchExamples ?? [] }, null, 2)),
      mediaType: "application/json", artifactType: researchExamplesPresent ? "research-examples" : "empty-research-examples",
      sources: [{ kind: "project", id: project.id, field: "researchExamples" }],
    },
    "cases.json": {
      bytes: currentCasesBytes, mediaType: "application/json", artifactType: "case-suite",
      sources: [{ kind: "project", id: project.id, field: "cases", reference: project.fileName }],
    },
  };
  if (project.caseGeneration) {
    const generationBytes = strToU8(JSON.stringify(project.caseGeneration, null, 2));
    artifacts["case-generation.json"] = {
      bytes: generationBytes, mediaType: "application/json", artifactType: "case-generation-provenance",
      sources: [{
        kind: "case-generation-artifact", id: project.caseGeneration.artifactId,
        field: "caseGeneration", digest: project.caseGeneration.digest,
      }],
    };
  }
  artifacts["report.md"] = {
    bytes: strToU8(run.report), mediaType: "text/markdown; charset=utf-8", artifactType: "run-report",
    sources: [{ kind: "run", id: run.id, field: "report" }],
  };
  artifacts["run.json"] = {
    bytes: strToU8(JSON.stringify(runEvidence, null, 2)), mediaType: "application/json", artifactType: "run-evidence",
    sources: [
      { kind: "run", id: run.id },
      ...(project.caseGeneration ? [{ kind: "case-generation-artifact", id: project.caseGeneration.artifactId, field: "caseGeneration", digest: project.caseGeneration.digest }] : []),
    ],
  };
  artifacts["refresh.json"] = {
    bytes: strToU8(JSON.stringify({
      schemaVersion: 1, refreshedAt, projectId: project.id, runId: run.id,
      caseSnapshotSource,
      caseSnapshotIds: snapshotCases.map(item => item.id),
      currentCaseIds: ids,
      runSelectedCaseIds: run.caseScope.selectedCaseIds,
      runExcludedCaseIds: run.caseScope.excludedCaseIds,
      ...(run.scopePlan ? { scopePlan: run.scopePlan } : {}),
      evidenceCaseIds: [...comparisonIds],
      casesWithoutRunEvidence: ids.filter(id => !comparisonIds.has(id)),
      evidenceForRemovedCases: [...comparisonIds].filter(id => !currentSet.has(id)),
      runSnapshotCasesSha256: sha256(currentCasesBytes),
      currentCasesSha256: sha256(strToU8(JSON.stringify(project.cases, null, 2))),
    }, null, 2)),
    mediaType: "application/json", artifactType: "refresh-coverage-reconciliation",
    sources: [{ kind: "project", id: project.id }, { kind: "run", id: run.id }],
  };
  artifacts["package.json"] = {
    bytes: strToU8(JSON.stringify({ private: true, scripts: { test: "node run.mjs" }, dependencies: { playwright: "^1.64.1" } }, null, 2)),
    mediaType: "application/json", artifactType: "package-runtime-metadata",
    sources: [{ kind: "package-refresh", id: run.id }],
  };
  artifacts["run.mjs"] = {
    bytes: strToU8(reusableRunner), mediaType: "text/javascript; charset=utf-8", artifactType: "deterministic-runner",
    sources: [{ kind: "previous-package", digest: previousPackageSha256 }],
  };

  for (const artifact of Object.values(artifacts)) {
    let content = new TextDecoder().decode(artifact.bytes);
    if (artifact.mediaType.startsWith("application/json")) {
      try {
        content = JSON.stringify(redactSensitiveExportData(JSON.parse(content)), null, 2);
      } catch {
        content = redactSensitiveExportText(content);
      }
    } else {
      content = redactSensitiveExportText(content);
    }
    artifact.bytes = strToU8(content);
  }

  // Hash every emitted payload. The manifest excludes itself to avoid a
  // self-referential digest; consumers can recompute every listed SHA-256.
  const manifest = {
    schemaVersion: 1,
    algorithm: "SHA-256",
    generatedAt: refreshedAt,
    projectId: project.id,
    runId: run.id,
    manifestPath: "artifacts.json",
    manifestSelfDigestExcluded: true,
    previousPackageSha256,
    artifacts: Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b)).map(([path, artifact]) => ({
      path,
      mediaType: artifact.mediaType,
      artifactType: artifact.artifactType,
      sizeBytes: artifact.bytes.byteLength,
      sha256: sha256(artifact.bytes),
      sources: artifact.sources,
    })),
  };
  const entries: Record<string, Uint8Array> = Object.fromEntries(
    Object.entries(artifacts).map(([path, artifact]) => [path, artifact.bytes]),
  );
  entries["artifacts.json"] = strToU8(JSON.stringify(manifest, null, 2));

  // A strict allowlist ensures stale suite/report metadata from the prior ZIP is discarded.
  return zipSync(entries);
}
