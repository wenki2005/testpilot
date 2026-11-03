import type { ChatMessage, ChatModelOptions } from "../ports/chat-model.js";
import type { DocumentProject, DocumentRun } from "../../domain/document-test-model.js";

/** Generate an evidence-bound summary for a fully aligned comparison run. */
export async function generateAlignedDocumentRunSummary(
  project: DocumentProject,
  run: DocumentRun,
  model: { complete(messages: ChatMessage[], options?: ChatModelOptions): Promise<unknown> },
): Promise<string> {
  const reportData = {
    project: project.name,
    sourceFile: project.fileName,
    targetUrl: project.targetUrl,
    runMode: run.runMode,
    executionIsolation: "确定性 lane 与视觉 Computer Use lane 顺序共用同一浏览器页面及登录态，不是隔离上下文中的独立复现。",
    caseScope: run.caseScope,
    scopePlan: run.scopePlan,
    scopeClassification: run.scopePlan ? "依据 scopePlan 区分直接目标与关联影响检查" : run.caseScopeKnown === false ? "历史记录没有直接目标/关联影响范围标注" : "本轮没有直接目标/关联影响范围计划",
    excludedCaseIds: run.caseScope.excludedCaseIds,
    recovery: run.recovery,
    stepGeneration: run.stepGeneration,
    caseGeneration: project.caseGeneration ? { artifactId: project.caseGeneration.artifactId, version: project.caseGeneration.version, digest: project.caseGeneration.digest, requirements: project.caseGeneration.requirements, qualitySummary: project.caseGeneration.qualitySummary, warnings: project.caseGeneration.warnings, transferredCases: project.caseGeneration.transferredCases } : undefined,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    baselineRunSnapshot: run.baselineRunSnapshot,
    baselineEnvironmentComparison: run.baselineEnvironmentComparison,
    baselineRunModeComparison: run.baselineRunModeComparison,
    cases: project.cases.filter(check => run.caseScope.selectedCaseIds.includes(check.id)).map(check => ({
      id: check.id, title: check.title, source: check.source, requirementRefs: check.requirementRefs, priority: check.priority, category: check.category, confidence: check.confidence, coverageAreas: check.coverageAreas,
      runScope: run.scopePlan?.targetCaseIds.includes(check.id) ? "直接目标" : run.scopePlan?.impactCaseIds.includes(check.id) ? "关联影响" : run.scopePlan ? "范围未分类" : run.caseScopeKnown === false ? "历史范围未标注" : "目标/影响未标注",
      preconditions: check.preconditions, preconditionsConfirmed: check.preconditionsConfirmed, testData: check.testData,
      sideEffectRisk: check.sideEffectRisk, cleanup: check.cleanup, expected: check.expected,
      comparison: run.comparisons.find(result => result.id === check.id),
      deterministicEvidence: run.deterministic.results.find(result => result.id === check.id),
      visualEvidence: run.ai.results.find(result => result.id === check.id),
    })),
    deterministic: run.deterministic.summary,
    visual: run.ai.summary,
  };
  const response = await model.complete([
    { role: "system", content: "你是 QA 报告编辑。严格根据输入中的用例、逐通道结果、证据、时间戳和基线快照撰写中文报告摘要。不得臆造缺陷、证据或限制，不得声称数据未记录，除非输入确实缺少该数据。明确说明覆盖边界；只报告本次实际执行的用例和结果。根据每条用例的 runScope 区分直接目标与关联影响检查，不得把关联影响检查写成迭代直接目标，也不得声称未选用例已验证。基线环境不同或环境未知、两轮执行方式不同或方式未知时，明确说明状态变化不能单独归因于版本迭代。两条通道顺序复用同一浏览器页面和登录态，不得描述成隔离会话的独立复现。若证据字段没有截图，不要假称存在截图。" },
    { role: "user", content: JSON.stringify(reportData) },
  ], { maxTokens: 1200, timeoutMs: 60_000 });
  const content = response && typeof response === "object" ? (response as { content?: unknown }).content : undefined;
  const summary = typeof content === "string" ? content.trim() : "";
  if (!summary) throw new Error("AI report generation returned no summary.");
  return summary;
}
