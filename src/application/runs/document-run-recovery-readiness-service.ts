import { planCheckpointRecovery } from "../../domain/document-checkpoint-recovery-integrity.js";
import type { DocumentProject, DocumentRun } from "../../domain/document-test-model.js";
import { getDocumentRunInvestigationFactSnapshot, type DocumentRunInvestigationRecord } from "./document-run-investigation-service.js";

export interface DocumentRunRecoveryReadinessDependencies {
  getRun(runId: string): Promise<DocumentRun | undefined>;
  getProject(projectId: string): Promise<DocumentProject | undefined>;
  getInvestigation?(runId: string): Promise<unknown>;
  redactText?(text: string): string;
  now?(): string;
  validateInputs?(project: DocumentProject, parent: DocumentRun, orderedCaseIds: string[]): Promise<void>;
}

export type RecoveryReadinessCandidate = {
  caseId: string; stepIndex: number; selectedCaseIds: string[];
  prerequisiteCaseIds: string[]; orderedCaseIds: string[];
  semantics: "rebuild-current-case";
};
export type RecoveryReadiness = {
  status: "ready" | "blocked"; blockers: string[]; candidates: RecoveryReadinessCandidate[];
  parentRunId: string; projectId: string; explanation: string;
  advice: { state: "available" | "unavailable"; provisional: true; recordId?: string; runDigest?: string; recommendations: Array<{ caseId: string; category: "product" | "test" | "environment" | "unknown"; strategy: "human-review" | "rebuild-readonly-case"; summary: string; evidence: Array<{ factId: string; quote: string }> }>; reason?: string };
};

/** Read-only preview for rebuilding a historical failed checkpoint against the current approved assets. */
export function createDocumentRunRecoveryReadinessService(deps: DocumentRunRecoveryReadinessDependencies) {
  return {
    async get(runId: string): Promise<RecoveryReadiness | undefined> {
      const parent = await deps.getRun(runId);
      if (!parent) return undefined;
      if (parent.id !== runId) throw new Error("运行存储返回的 ID 与请求不一致。");
      const blockers: string[] = [];
      const project = await deps.getProject(parent.projectId);
      if (!project) return undefined;
      if (project.id !== parent.projectId) throw new Error("项目存储返回的 ID 与父运行不一致。");
      if (!parent.completedAt || !["failed", "cancelled", "unresolved", "partial"].includes(parent.overall)) blockers.push("父运行尚未终结，或没有可恢复的失败/未验证结果。");
      if (project.reviewStatus !== "approved") blockers.push("当前项目尚未审核通过。");
      let investigation: unknown;
      try { investigation = await deps.getInvestigation?.(parent.id); } catch { investigation = { __readFailed: true }; }
      // Investigation hypotheses are advisory only. They never affect selection or expected results.

      const candidates: RecoveryReadinessCandidate[] = [];
      const latestFailedByCase = new Map<string, { caseId: string; stepIndex: number }>();
      for (const point of parent.stepLogs ?? []) if (point.phase === "failed") latestFailedByCase.set(point.caseId, point);
      const points = [...latestFailedByCase.values()];
      if (parent.stepCheckpoint && !latestFailedByCase.has(parent.stepCheckpoint.caseId)) points.push(parent.stepCheckpoint);
      for (const point of points) {
        try {
          const recovery = planCheckpointRecovery(project, parent, point.caseId, point.stepIndex);
          await deps.validateInputs?.(project, parent, recovery.orderedCaseIds);
          candidates.push({ caseId: point.caseId, stepIndex: point.stepIndex, ...recovery, semantics: "rebuild-current-case" });
        } catch (error) { blockers.push(error instanceof Error ? error.message : "检查点完整性无法验证。"); }
      }
      if (!candidates.length && !blockers.some(item => item.includes("检查点") || item.includes("失败检查点"))) blockers.push("父运行没有可验证的真实失败检查点。");
      const uniqueBlockers = [...new Set(blockers)];
      const hasGlobalBlocker = project.reviewStatus !== "approved" || !parent.completedAt || !["failed", "cancelled", "unresolved", "partial"].includes(parent.overall);
      const advice = buildAdvice(investigation, parent, candidates, deps.redactText ?? (value => value), deps.now?.() ?? new Date().toISOString(), hasGlobalBlocker || candidates.length === 0);
      return { status: hasGlobalBlocker || candidates.length === 0 ? "blocked" : "ready", blockers: uniqueBlockers, candidates, advice,
        parentRunId: parent.id, projectId: project.id,
        explanation: `恢复会沿用父运行参数（未留存时按空参数）、数据集、档案和网站版本快照，在新运行中重建当前用例及其只读前置，并从当前用例第一步重新验证；不会跳过断言或修改历史结果。调查${investigation ? "假设" : "记录"}仅供参考，不授权执行，也不改变预期。` };
    }
  };
}

function buildAdvice(raw: unknown, run: DocumentRun, candidates: RecoveryReadinessCandidate[], redact: (text: string) => string, now: string, blocked: boolean): RecoveryReadiness["advice"] {
  const unavailable = (reason: string): RecoveryReadiness["advice"] => ({ state: "unavailable", provisional: true, recommendations: [], reason });
  if (!raw) return unavailable("没有可用的调查记录。");
  if ((raw as { __readFailed?: boolean }).__readFailed) return unavailable("调查记录读取失败。");
  try {
    const record = raw as DocumentRunInvestigationRecord;
    const snapshot = getDocumentRunInvestigationFactSnapshot(run, redact);
    if (record.provisional !== true || typeof record.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(record.id) || record.runId !== run.id || record.projectId !== run.projectId || !["complete", "partial"].includes(record.coverage)) return unavailable("调查记录归属或状态无效。");
    const created = Date.parse(record.createdAt), current = Date.parse(now);
    if (!Number.isFinite(created) || !Number.isFinite(current) || created > current || !run.completedAt || !Number.isFinite(Date.parse(run.completedAt)) || created < Date.parse(run.completedAt)) return unavailable("调查记录日期无效。");
    if (record.runDigest !== snapshot.runDigest || !Array.isArray(record.facts) || JSON.stringify(record.facts) !== JSON.stringify(snapshot.facts)) return unavailable("调查记录与当前运行事实不一致。");
    const validFacts = new Map(snapshot.facts.map(fact => [fact.factId, fact]));
    if (!Array.isArray(record.hypotheses)) return unavailable("调查记录结构无效。");
    const recommendations = record.hypotheses.flatMap(h => {
      if (!h || !snapshot.facts.some(f => f.caseId === h.caseId) || !["product", "test", "environment", "unknown"].includes(h.category) || typeof h.summary !== "string" || !Array.isArray(h.evidence)) return [];
      const evidence = h.evidence.filter(ref => { const fact = validFacts.get(ref.factId); return Boolean(fact && fact.caseId === h.caseId && typeof ref.quote === "string" && ref.quote.trim() && fact.text.includes(ref.quote)); });
      if (!evidence.length || !h.summary.trim()) return [];
      const canRebuild = !blocked && h.category === "environment" && candidates.some(candidate => candidate.caseId === h.caseId);
      return [{ caseId: h.caseId, category: h.category, strategy: canRebuild ? "rebuild-readonly-case" as const : "human-review" as const, summary: redact(h.summary).slice(0, 1200), evidence: evidence.map(ref => ({ factId: ref.factId, quote: ref.quote })) }];
    });
    return recommendations.length ? { state: "available", provisional: true, recordId: record.id, runDigest: snapshot.runDigest, recommendations } : unavailable("没有可验证的同用例调查引用。");
  } catch { return unavailable("调查记录无法验证。"); }
}
