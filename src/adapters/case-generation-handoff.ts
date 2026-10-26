import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { CaseGenerationResult, GeneratedTestCase } from "./case-generation-agent.js";
import { caseCategories, inferCaseCategory } from "./document-test-types.js";
import type { BrowserCheck, DocumentProject } from "./document-test-workflow.js";

const priorities = ["P0", "P1", "P2", "P3"] as const;
const confidenceLevels = ["high", "medium", "low"] as const;
const requirementScopes = ["in-scope", "out-of-scope", "deferred", "uncertain"] as const;
const scenarioTypes = ["positive", "negative", "boundary", "state-transition", "authorization", "accessibility", "compatibility", "exploratory", "other", "existing"] as const;
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u);
const longText = z.string().max(100_000);
const textList = (maxItems: number, maxLength = 100_000) => z.array(z.string().max(maxLength)).max(maxItems);
const uniqueItems = <T extends string>(values: T[]) => new Set(values).size === values.length;

const requirementSchema = z.object({
  id: identifier,
  text: z.string().min(1).max(1_000),
  source: z.string().min(1).max(2_000),
  priority: z.enum(priorities),
  confidence: z.enum(confidenceLevels),
  scopeStatus: z.enum(requirementScopes),
  scopeRationale: z.string().max(2_000),
}).strict();

const generatedCaseSchema = z.object({
  id: identifier,
  origin: z.enum(["existing", "ai-draft"]),
  title: z.string().min(1).max(200),
  requirementIds: textList(100, 128).superRefine((values, context) => {
    if (!uniqueItems(values)) context.addIssue({ code: "custom", message: "需求引用不能重复" });
  }),
  sourceRefs: textList(100),
  scenarioType: z.enum(scenarioTypes),
  priority: z.enum(priorities),
  preconditions: textList(100),
  testData: textList(100),
  actions: textList(100),
  expectedResult: z.string().min(1).max(100_000),
  confidence: z.enum(confidenceLevels),
  clarificationNeeded: textList(100),
}).strict();

const coverageRowSchema = z.object({
  requirementId: identifier,
  scopeStatus: z.enum(requirementScopes),
  coverageStatus: z.enum(["covered", "uncovered", "out-of-scope", "deferred", "uncertain"]),
  aiCaseIds: textList(280, 128),
  referenceCaseIds: textList(200, 128),
  referenceStatus: z.enum(["covered", "partial", "uncovered", "uncertain"]),
  rationale: longText,
}).strict();

const benchmarkRelation = z.enum(["duplicate", "overlap", "novel", "uncertain"]);
const benchmarkItemSchema = z.object({
  aiCaseId: identifier,
  relation: benchmarkRelation,
  referenceCaseIds: textList(200, 128),
  rationale: longText,
}).strict();

const semanticReviewCaseSchema = z.object({
  aiCaseId: identifier,
  score: z.number().int().min(0).max(100),
  dimensions: z.object({
    actionability: z.number().int().min(0).max(2),
    observability: z.number().int().min(0).max(2),
    grounding: z.number().int().min(0).max(2),
    atomicity: z.number().int().min(0).max(2),
    fixtureReadiness: z.number().int().min(0).max(2),
  }).strict(),
  issues: textList(20, 2_000),
}).strict();

const nonNegativeInteger = z.number().int().min(0);
const score = z.number().finite().min(0).max(100);
const generationSchema = z.object({
  requirements: z.array(requirementSchema).max(100),
  cases: z.array(generatedCaseSchema).max(280),
  coverageMatrix: z.array(coverageRowSchema).max(100),
  quality: z.object({
    duplicateCount: nonNegativeInteger,
    untracedCaseIds: textList(280, 128),
    clarificationCount: nonNegativeInteger,
    uncoveredByDraftsRequirementIds: textList(100, 128),
    aiDraftScore: z.object({ average: score, completeCases: nonNegativeInteger, assessedCases: nonNegativeInteger }).strict(),
    semanticReview: z.object({
      average: score,
      strongCases: nonNegativeInteger,
      needsReviewCases: nonNegativeInteger,
      assessedCases: nonNegativeInteger,
      dimensions: z.array(z.object({ name: z.string().min(1).max(200), average: score, issueCount: nonNegativeInteger }).strict()).max(20),
      cases: z.array(semanticReviewCaseSchema).max(280),
    }).strict(),
    scopeSummary: z.object({ inScope: nonNegativeInteger, covered: nonNegativeInteger, uncovered: nonNegativeInteger, outOfScope: nonNegativeInteger, deferred: nonNegativeInteger, uncertain: nonNegativeInteger }).strict(),
    benchmarkComparison: z.object({
      referenceCount: nonNegativeInteger,
      evaluatedCases: nonNegativeInteger,
      duplicateCandidates: nonNegativeInteger,
      overlapCount: nonNegativeInteger,
      novelCount: nonNegativeInteger,
      items: z.array(benchmarkItemSchema).max(280),
    }).strict(),
  }).strict(),
  warnings: textList(500),
  sources: z.array(z.object({
    kind: z.enum(["requirements", "website-content", "website-reference", "existing-cases", "public-examples"]),
    label: z.string().min(1).max(2_000),
    reference: z.string().max(10_000).optional(),
  }).strict()).max(100),
}).strict();

const caseGenerationTraceSchema = z.object({
  sourceCaseId: identifier,
  sourceRefs: textList(100),
  actions: textList(100),
  scenarioType: z.enum(scenarioTypes),
  clarificationNeeded: textList(100),
  original: generatedCaseSchema,
}).strict();

/** Validate the case-level provenance copied into an executable project. */
export function validateCaseGenerationTrace(value: unknown): HandoffCase["caseGenerationTrace"] {
  const parsed = caseGenerationTraceSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 4).map(issue => `${issue.path.join(".") || "trace"}：${issue.message}`);
    throw new Error(`用例生成追溯记录无效：${details.join("；") || "字段不符合 schema"}。`);
  }
  const trace = parsed.data;
  if (trace.sourceCaseId !== trace.original.id || trace.scenarioType !== trace.original.scenarioType || JSON.stringify(trace.sourceRefs) !== JSON.stringify(trace.original.sourceRefs) || JSON.stringify(trace.actions) !== JSON.stringify(trace.original.actions) || JSON.stringify(trace.clarificationNeeded) !== JSON.stringify(trace.original.clarificationNeeded)) {
    throw new Error("用例生成追溯字段与原始生成用例不一致。未保存不一致来源。");
  }
  return trace as HandoffCase["caseGenerationTrace"];
}

type HandoffCase = BrowserCheck & {
  /** Full case-design fields survive project load/save and remain separate from executable BrowserStep DSL. */
  caseGenerationTrace: {
    sourceCaseId: string;
    sourceRefs: string[];
    actions: string[];
    scenarioType: GeneratedTestCase["scenarioType"];
    clarificationNeeded: string[];
    original: GeneratedTestCase;
  };
};

type HandoffProject = Omit<DocumentProject, "cases" | "caseGeneration"> & {
  cases: HandoffCase[];
  caseGeneration: NonNullable<DocumentProject["caseGeneration"]> & { rawResult: CaseGenerationResult };
};

/**
 * Turn an independently generated case-design artifact into a draft document
 * test project. Runtime validation is intentionally repeated at this boundary:
 * this function is also called with untrusted HTTP request data.
 */
export function createExecutionDraftFromCaseGeneration(input: {
  targetUrl: unknown;
  name?: unknown;
  generation: unknown;
}): HandoffProject {
  const targetUrl = typeof input.targetUrl === "string" ? input.targetUrl.trim() : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) throw new Error();
  } catch {
    throw new Error("执行目标必须是有效的 HTTP 或 HTTPS 网址，且不能在 URL 中包含用户名或密码。");
  }
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim().length > 120)) {
    throw new Error("项目名称必须是 120 字以内的文本。");
  }

  const parsed = generationSchema.safeParse(input.generation);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 8).map(issue => `${issue.path.length ? issue.path.join(".") : "generation"}：${issue.message}`);
    const remainder = parsed.error.issues.length > details.length ? `；另有 ${parsed.error.issues.length - details.length} 项错误` : "";
    throw new Error(`用例生成结果校验失败：${details.join("；")}${remainder}。未创建执行草稿。`);
  }
  const generation = parsed.data as CaseGenerationResult;
  validateGenerationReferences(generation);
  const requirements = new Map(generation.requirements.map(item => [item.id, item]));
  const aiCases = generation.cases.filter(item => item.origin === "ai-draft");
  if (!aiCases.length) throw new Error("生成结果中没有 AI 用例；留出的既有用例基准不会转入执行套件。");

  const cases: HandoffCase[] = aiCases.map((item, index) => {
    const linked = item.requirementIds.map(id => requirements.get(id)!);
    const allLinkedInScope = linked.length > 0 && linked.every(requirement => requirement.scopeStatus === "in-scope");
    const requirementRefs = linked.map(requirement => `${requirement.id} [${requirement.scopeStatus}]`);
    const unresolved = [...item.preconditions, ...item.clarificationNeeded.map(value => `待澄清：${value}`)];
    validateProjectCaseCompatibility(item, unresolved, index);
    const category = inferCaseCategory(`${item.scenarioType} ${item.title} ${item.expectedResult}`);
    const validCategory = caseCategories.includes(category) ? category : "functional";
    const displaySource = item.sourceRefs[0] && item.sourceRefs[0].length <= 500 ? item.sourceRefs[0] : item.sourceRefs.length ? "完整来源引用见用例生成追溯记录" : "来源未标明";
    const projectCaseId = `AI-${String(index + 1).padStart(3, "0")}`;
    return {
      id: projectCaseId,
      title: item.title.trim(),
      source: displaySource,
      requirementRefs,
      priority: item.priority,
      category: validCategory,
      confidence: item.confidence,
      coverageAreas: [validCategory],
      selectedForRegression: allLinkedInScope,
      preconditions: unresolved,
      preconditionsConfirmed: unresolved.length === 0,
      testData: item.testData,
      sideEffectRisk: "unknown",
      cleanup: "",
      kind: "visible",
      expected: item.expectedResult.trim(),
      steps: [],
      ...(!allLinkedInScope ? { coverageGap: "没有关联到已确认的本期范围需求；需人工确认执行范围。" } : {}),
      caseGenerationTrace: {
        sourceCaseId: item.id,
        sourceRefs: [...item.sourceRefs],
        actions: [...item.actions],
        scenarioType: item.scenarioType,
        clarificationNeeded: [...item.clarificationNeeded],
        original: structuredClone(item),
      },
    };
  });

  const now = new Date().toISOString();
  const generationDigest = createHash("sha256").update(JSON.stringify(generation)).digest("hex");
  const requirementsText = generation.requirements.map(item => `- ${item.id} [${item.scopeStatus}] [${item.priority}] ${item.text}\n  来源：${item.source}\n  范围依据：${item.scopeRationale}`).join("\n");
  const sourceText = [
    "# AI 独立生成的测试用例",
    "",
    "此项目由独立用例生成 Agent 移交。既有用例基准只用于事后比较，没有转入执行用例。所有用例均为待审草稿，没有生成或批准浏览器步骤。",
    "",
    "## 需求与范围清单",
    requirementsText || "无需求条目",
    "",
    "## 生成质量提醒",
    ...generation.warnings.map(warning => `- ${warning}`),
  ].join("\n");

  const safeName = typeof input.name === "string" && input.name.trim() ? input.name.trim() : `${parsedUrl.hostname} 用例生成结果`;
  const project: HandoffProject = {
    id: randomUUID(),
    name: safeName,
    fileName: "AI 生成用例草稿",
    sourceFiles: ["AI 独立用例生成结果"],
    caseMode: "ai",
    caseGeneration: {
      artifactId: randomUUID(),
      version: 1,
      generatedAt: now,
      digest: generationDigest,
      requirements: generation.requirements.map(item => ({ id: item.id, text: item.text, source: item.source, priority: item.priority, confidence: item.confidence, scopeStatus: item.scopeStatus, scopeRationale: item.scopeRationale })),
      qualitySummary: generation.quality as unknown as Record<string, unknown>,
      warnings: [...generation.warnings],
      sources: generation.sources.map(item => ({ ...item })),
      transferredCases: aiCases.map((item, index) => ({ sourceCaseId: item.id, projectCaseId: `AI-${String(index + 1).padStart(3, "0")}` })),
      rawResult: structuredClone(generation),
    },
    confirmationRequired: true,
    workflowPlan: [
      "用例生成 Agent：独立生成需求清单与用例；既有用例基准仅用于事后质量比较。",
      "用例审查 Agent：逐条检查需求追溯、预期可判定性、数据与风险；执行前由用户审核。",
      "步骤作者 Agent：基于目标页面证据将选中用例转成受限 BrowserStep DSL；不能运行任意代码。",
      "确定性执行 Agent：只运行通过审核和只读安全门禁的步骤并保存证据。",
      "Computer Use Agent：在同一项目浏览器会话中提供第二种界面观察结果，不视为隔离复现。",
      "结果分析 Agent：按用例 ID 对照结果，区分失败、阻塞、环境问题与结论不一致。",
      "报告与打包 Agent：基于结构化运行证据生成报告和可复用脚本包。",
    ],
    format: "markdown",
    targetUrl: parsedUrl.toString(),
    sourceText,
    cases,
    reviewStatus: "draft",
    reviewNotes: "由独立用例生成 Agent 移交。步骤尚未生成；本项目尚未审核、执行或产出运行报告。",
    createdAt: now,
    updatedAt: now,
  };
  return project;
}

function validateProjectCaseCompatibility(item: GeneratedTestCase, unresolved: string[], index: number): void {
  const label = `AI 用例「${item.title.slice(0, 80)}」`;
  if (item.title.length > 160) throw new Error(`${label}的标题超过测试项目的 160 字限制（生成结果未修改，请缩短标题后重试）。`);
  if (item.expectedResult.length > 300) throw new Error(`${label}的预期结果超过测试项目的 300 字限制（生成结果未修改，请拆分或精简预期后重试）。`);
  if (unresolved.length > 10 || unresolved.some(value => value.length > 500)) throw new Error(`第 ${index + 1} 条 AI 用例的前置条件与待澄清项超出项目字段限制（最多 10 条、每条 500 字）；原生成结果未修改。`);
  if (item.testData.length > 10 || item.testData.some(value => value.length > 500)) throw new Error(`${label}的测试数据超出项目字段限制（最多 10 条、每条 500 字）；原生成结果未修改。`);
}

function validateGenerationReferences(generation: CaseGenerationResult): void {
  const fail = (message: string): never => { throw new Error(`用例生成结果校验失败：${message}。未创建执行草稿。`); };
  const uniqueIds = (items: Array<{ id: string }>, label: string) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) fail(`${label}存在重复 ID「${item.id}」`);
      seen.add(item.id);
    }
  };
  uniqueIds(generation.requirements, "需求清单");
  uniqueIds(generation.cases, "用例清单");

  const requirements = new Map(generation.requirements.map(item => [item.id, item]));
  const aiCases = new Map(generation.cases.filter(item => item.origin === "ai-draft").map(item => [item.id, item]));
  const baselineCases = new Map(generation.cases.filter(item => item.origin === "existing").map(item => [item.id, item]));
  for (const item of generation.cases) {
    for (const id of item.requirementIds) if (!requirements.has(id)) fail(`用例「${item.id}」引用了不存在的需求 ID「${id}」`);
  }

  if (generation.coverageMatrix.length !== requirements.size) fail("coverageMatrix 必须为每条需求提供且只提供一行");
  const matrixByRequirement = new Map<string, (typeof generation.coverageMatrix)[number]>();
  for (const row of generation.coverageMatrix) {
    if (!requirements.has(row.requirementId)) fail(`覆盖矩阵引用了不存在的需求 ID「${row.requirementId}」`);
    if (matrixByRequirement.has(row.requirementId)) fail(`覆盖矩阵的需求 ID「${row.requirementId}」重复`);
    const requirement = requirements.get(row.requirementId)!;
    if (row.scopeStatus !== requirement.scopeStatus) fail(`覆盖矩阵「${row.requirementId}」的范围状态与需求清单不一致`);
    const expectedAiIds = [...aiCases.values()].filter(item => item.requirementIds.includes(row.requirementId)).map(item => item.id).sort();
    if ([...row.aiCaseIds].sort().join("\0") !== expectedAiIds.join("\0")) fail(`覆盖矩阵「${row.requirementId}」的 AI 用例引用与用例清单不一致`);
    for (const id of row.referenceCaseIds) if (!baselineCases.has(id)) fail(`覆盖矩阵引用了不存在的基准用例 ID「${id}」`);
    matrixByRequirement.set(row.requirementId, row);
  }

  const expectedCoverage: Record<(typeof requirementScopes)[number], (typeof generation.coverageMatrix)[number]["coverageStatus"]> = {
    "in-scope": "uncovered", "out-of-scope": "out-of-scope", deferred: "deferred", uncertain: "uncertain",
  };
  for (const row of generation.coverageMatrix) {
    const expected = row.scopeStatus === "in-scope" && row.aiCaseIds.length ? "covered" : expectedCoverage[row.scopeStatus];
    if (row.coverageStatus !== expected) fail(`覆盖矩阵「${row.requirementId}」的 coverageStatus 与关联用例或范围状态不一致`);
  }

  const benchmark = generation.quality.benchmarkComparison;
  if (benchmark.referenceCount !== baselineCases.size) fail(`基准比较记录 ${benchmark.referenceCount} 条基准，但原结果中有 ${baselineCases.size} 条`);
  const baselineSourceCount = generation.sources.filter(source => source.kind === "existing-cases").length;
  if (baselineSourceCount !== (baselineCases.size ? 1 : 0)) fail("留出基准必须在 sources 中以 existing-cases 来源角色明确标记");
  if (benchmark.items.length !== aiCases.size || benchmark.evaluatedCases !== benchmark.items.length) fail("benchmarkComparison 必须为每条 AI 用例提供且只提供一条评估记录");
  const benchmarkAiIds = new Set<string>();
  const relationCounts = { duplicate: 0, overlap: 0, novel: 0 };
  for (const item of benchmark.items) {
    if (!aiCases.has(item.aiCaseId)) fail(`基准比较引用了不存在的 AI 用例 ID「${item.aiCaseId}」`);
    if (benchmarkAiIds.has(item.aiCaseId)) fail(`基准比较的 AI 用例 ID「${item.aiCaseId}」重复`);
    benchmarkAiIds.add(item.aiCaseId);
    for (const id of item.referenceCaseIds) if (!baselineCases.has(id)) fail(`基准比较引用了不存在的基准用例 ID「${id}」`);
    if (item.relation !== "uncertain") relationCounts[item.relation] += 1;
  }
  if (benchmark.duplicateCandidates !== relationCounts.duplicate || benchmark.overlapCount !== relationCounts.overlap || benchmark.novelCount !== relationCounts.novel) fail("基准比较计数与逐用例关系记录不一致");

  for (const row of generation.coverageMatrix) {
    const linkedReviews = benchmark.items.filter(item => row.aiCaseIds.includes(item.aiCaseId));
    const expectedReferenceIds = [...new Set(linkedReviews.flatMap(item => item.referenceCaseIds))].sort();
    if ([...row.referenceCaseIds].sort().join("\0") !== expectedReferenceIds.join("\0")) fail(`覆盖矩阵「${row.requirementId}」的基准用例引用与逐用例比较结果不一致`);
    const expectedReferenceStatus = !linkedReviews.length || linkedReviews.some(item => item.relation === "uncertain")
      ? "uncertain"
      : linkedReviews.some(item => item.relation === "duplicate")
        ? "covered"
        : linkedReviews.some(item => item.relation === "overlap")
          ? "partial"
          : "uncovered";
    if (row.referenceStatus !== expectedReferenceStatus) fail(`覆盖矩阵「${row.requirementId}」的 referenceStatus 与逐用例比较结果不一致`);
  }

  for (const id of generation.quality.untracedCaseIds) if (!aiCases.has(id)) fail(`质量摘要引用了不存在的 AI 用例 ID「${id}」`);
  for (const id of generation.quality.uncoveredByDraftsRequirementIds) {
    const row = matrixByRequirement.get(id);
    if (!row || row.scopeStatus !== "in-scope" || row.coverageStatus !== "uncovered") fail(`未覆盖需求列表中的 ID「${id}」不是本期范围内的未覆盖需求`);
  }
  const expectedClarificationCount = generation.cases.filter(item => item.clarificationNeeded.length > 0).length;
  if (generation.quality.clarificationCount !== expectedClarificationCount) fail("clarificationCount 与用例清单不一致");
  if (generation.quality.aiDraftScore.assessedCases !== aiCases.size || generation.quality.aiDraftScore.completeCases > aiCases.size) fail("aiDraftScore 数量与 AI 用例清单不一致");
  if (generation.quality.semanticReview.assessedCases !== generation.quality.semanticReview.cases.length) fail("semanticReview assessedCases 与逐用例评估数量不一致");
  const semanticIds = new Set<string>();
  for (const item of generation.quality.semanticReview.cases) {
    if (!aiCases.has(item.aiCaseId)) fail(`语义评估引用了不存在的 AI 用例 ID「${item.aiCaseId}」`);
    if (semanticIds.has(item.aiCaseId)) fail(`语义评估的 AI 用例 ID「${item.aiCaseId}」重复`);
    semanticIds.add(item.aiCaseId);
  }
  const scopeCounts = {
    inScope: generation.coverageMatrix.filter(item => item.scopeStatus === "in-scope").length,
    covered: generation.coverageMatrix.filter(item => item.scopeStatus === "in-scope" && item.coverageStatus === "covered").length,
    uncovered: generation.coverageMatrix.filter(item => item.scopeStatus === "in-scope" && item.coverageStatus === "uncovered").length,
    outOfScope: generation.coverageMatrix.filter(item => item.scopeStatus === "out-of-scope").length,
    deferred: generation.coverageMatrix.filter(item => item.scopeStatus === "deferred").length,
    uncertain: generation.coverageMatrix.filter(item => item.scopeStatus === "uncertain").length,
  };
  for (const key of Object.keys(scopeCounts) as Array<keyof typeof scopeCounts>) {
    if (generation.quality.scopeSummary[key] !== scopeCounts[key]) fail(`scopeSummary.${key} 与覆盖矩阵不一致`);
  }
}
