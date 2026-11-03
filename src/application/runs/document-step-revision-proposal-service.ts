import { createHash, randomUUID } from "node:crypto";
import type { BrowserCheck, BrowserStep, DocumentProject, DocumentRun } from "../../domain/document-test-model.js";
import { isSafeReadOnlyBrowserCase } from "../../domain/document-case-authoring.js";
import { getDocumentRunInvestigationFactSnapshot, type DocumentRunInvestigationRecord } from "./document-run-investigation-service.js";

export type StepRevisionProposalStatus = "pending-review" | "accepted" | "rejected" | "stale";
export type StepRevisionProposal = {
  id: string;
  projectId: string;
  runId: string;
  investigationId: string;
  runDigest: string;
  caseId: string;
  expected: string;
  currentStepsDigest: string;
  currentSteps: BrowserStep[];
  proposedSteps: BrowserStep[];
  evidence: Array<{ factId: string; quote: string }>;
  changeSummary: string;
  impactSummary: string;
  status: StepRevisionProposalStatus;
  createdAt: string;
  reviewedAt?: string;
};

export type StepRevisionProposalRepository = {
  save(proposal: StepRevisionProposal): Promise<void>;
  get(id: string): Promise<StepRevisionProposal | undefined>;
  list(projectId: string): Promise<StepRevisionProposal[]>;
  withReviewLock?<T>(projectId: string, caseId: string, action: () => Promise<T>): Promise<T>;
  inspectReviewLock?(projectId: string, caseId: string): Promise<{ present: boolean; path: string }>;
};

export type StepRevisionProposalEvaluation = {
  steps: BrowserStep[];
  changeSummary: string;
  impactSummary: string;
  evidence: Array<{ factId: string; quote: string }>;
};

export function getStepRevisionDigest(steps: BrowserStep[]): string {
  return createHash("sha256").update(JSON.stringify(steps)).digest("hex");
}

export class StepRevisionProposalError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

export function createDocumentStepRevisionProposalService(deps: {
  getRun(id: string): Promise<DocumentRun | undefined>;
  getProject(id: string): Promise<DocumentProject | undefined>;
  getInvestigation(runId: string): Promise<DocumentRunInvestigationRecord | null>;
  evaluate(input: {
    caseSnapshot: BrowserCheck;
    currentSteps: BrowserStep[];
    expected: string;
    facts: DocumentRunInvestigationRecord["facts"];
    hypothesis: DocumentRunInvestigationRecord["hypotheses"][number];
  }): Promise<unknown>;
  validateCases(cases: unknown[]): BrowserCheck[];
  redactText(text: string): string;
  repository: StepRevisionProposalRepository;
  mutateProject(id: string, mutate: (project: DocumentProject) => void): Promise<DocumentProject | undefined>;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const activeCreates = new Map<string, Promise<StepRevisionProposal>>();
  const activeReviews = new Set<string>();

  async function context(runId: string, caseId: string) {
    const run = await deps.getRun(runId);
    if (!run || run.id !== runId || !["failed", "partial"].includes(run.overall)
      || !run.completedAt || !Number.isFinite(Date.parse(run.completedAt))) {
      throw new StepRevisionProposalError("只有已完成且结果为失败或部分完成的运行可以提出步骤修订。", 409);
    }
    const investigation = await deps.getInvestigation(runId);
    if (!investigation || investigation.runId !== run.id || investigation.projectId !== run.projectId || investigation.provisional !== true) {
      throw new StepRevisionProposalError("当前运行没有可用的待验证调查记录。", 409);
    }
    const factSnapshot = getDocumentRunInvestigationFactSnapshot(run, deps.redactText);
    if (factSnapshot.runDigest !== investigation.runDigest) {
      throw new StepRevisionProposalError("调查记录已过期，运行事实发生变化；请刷新调查后再提出修订。", 409);
    }
    const hypothesis = investigation.hypotheses.find(item => item.caseId === caseId);
    if (!hypothesis || hypothesis.category === "unknown" || !hypothesis.evidence.length) {
      throw new StepRevisionProposalError("该用例没有带有效证据的可修订调查假设。", 422);
    }
    for (const citation of hypothesis.evidence) {
      if (!investigation.facts.some(fact => fact.caseId === caseId && fact.factId === citation.factId && fact.text.includes(citation.quote))) {
        throw new StepRevisionProposalError("调查引用与同一用例的已存事实不匹配。", 422);
      }
    }
    const frozenCase = [...(run.caseSnapshots ?? []), ...(run.executionCaseSnapshots ?? [])].find(item => item.id === caseId);
    const project = await deps.getProject(run.projectId);
    const current = project?.cases.find(item => item.id === caseId);
    if (!project || !current || !frozenCase || current.expected !== frozenCase.expected) {
      throw new StepRevisionProposalError("当前项目、用例或冻结预期与失败运行不匹配。", 409);
    }
    if (getStepRevisionDigest(current.steps) !== getStepRevisionDigest(frozenCase.steps)) {
      throw new StepRevisionProposalError("用例步骤在失败运行后已经变化；请先复核最新版本，不能从旧失败自动提出修订。", 409);
    }
    if (current.sideEffectRisk !== "none" || (current.preconditions?.length && current.preconditionsConfirmed !== true) || !isSafeReadOnlyBrowserCase(current)) {
      throw new StepRevisionProposalError("该用例没有满足只读安全条件；自动提案不会修改业务写入、未确认前置或风险未定的用例。", 422);
    }
    return { run, investigation, hypothesis, frozenCase, current, project };
  }

  function validateEvaluation(raw: unknown, caseId: string, current: BrowserCheck, facts: DocumentRunInvestigationRecord["facts"]): StepRevisionProposalEvaluation {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StepRevisionProposalError("步骤修订模型响应格式无效。", 502);
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some(key => !["steps", "changeSummary", "impactSummary", "evidence"].includes(key))
      || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 30
      || typeof value.changeSummary !== "string" || !value.changeSummary.trim() || value.changeSummary.length > 2000
      || typeof value.impactSummary !== "string" || !value.impactSummary.trim() || value.impactSummary.length > 2000
      || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 12) {
      throw new StepRevisionProposalError("提案只能包含步骤、变更说明、影响说明和原文证据引用。", 502);
    }
    const evidence = value.evidence.flatMap(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const candidate = item as Record<string, unknown>;
      if (Object.keys(candidate).some(key => key !== "factId" && key !== "quote")
        || typeof candidate.factId !== "string" || typeof candidate.quote !== "string" || !candidate.quote.trim()) return [];
      const fact = facts.find(row => row.caseId === caseId && row.factId === candidate.factId);
      return fact && fact.text.includes(candidate.quote) ? [{ factId: fact.factId, quote: candidate.quote }] : [];
    });
    if (!evidence.length || evidence.length !== value.evidence.length) throw new StepRevisionProposalError("提案的证据引用必须精确对应同一用例的调查事实。", 502);
    const candidateCase = deps.validateCases([{ ...current, steps: value.steps }])[0];
    if (!candidateCase || candidateCase.expected !== current.expected || candidateCase.id !== current.id
      || getStepRevisionDigest(candidateCase.steps) === getStepRevisionDigest(current.steps)
      || candidateCase.sideEffectRisk !== "none" || !isSafeReadOnlyBrowserCase(candidateCase)) {
      throw new StepRevisionProposalError("拟议步骤没有通过用例、预期和只读安全校验。", 422);
    }
    const changeSummary = deps.redactText(value.changeSummary).trim().slice(0, 1200);
    const impactSummary = deps.redactText(value.impactSummary).trim().slice(0, 1200);
    if (!changeSummary || !impactSummary) throw new StepRevisionProposalError("提案说明在脱敏后为空，不能保存。", 422);
    return { steps: candidateCase.steps, changeSummary, impactSummary, evidence };
  }

  async function createOnce(runId: string, caseId: string): Promise<StepRevisionProposal> {
    const before = await context(runId, caseId);
    const prior = (await deps.repository.list(before.project.id)).find(item => item.runId === runId && item.caseId === caseId && item.status === "pending-review");
    if (prior) return prior;
    let raw: unknown;
    try {
      raw = await deps.evaluate({
        caseSnapshot: structuredClone(before.frozenCase),
        currentSteps: structuredClone(before.current.steps),
        expected: before.current.expected,
        facts: structuredClone(before.investigation.facts.filter(item => item.caseId === caseId)),
        hypothesis: structuredClone(before.hypothesis),
      });
    } catch { throw new StepRevisionProposalError("步骤修订模型请求失败。", 502); }
    const evaluation = validateEvaluation(raw, caseId, before.current, before.investigation.facts);
    const after = await context(runId, caseId);
    if (after.project.id !== before.project.id || after.investigation.id !== before.investigation.id
      || after.investigation.runDigest !== before.investigation.runDigest || after.current.expected !== before.current.expected
      || getStepRevisionDigest(after.current.steps) !== getStepRevisionDigest(before.current.steps)) {
      throw new StepRevisionProposalError("提案生成期间项目、脚本或调查记录发生变化；未保存过期提案。", 409);
    }
    const proposal: StepRevisionProposal = {
      id: randomUUID(), projectId: before.project.id, runId, investigationId: before.investigation.id,
      runDigest: before.investigation.runDigest, caseId, expected: before.current.expected,
      currentStepsDigest: getStepRevisionDigest(before.current.steps), currentSteps: structuredClone(before.current.steps),
      proposedSteps: evaluation.steps, evidence: evaluation.evidence,
      changeSummary: evaluation.changeSummary, impactSummary: evaluation.impactSummary,
      status: "pending-review", createdAt: now(),
    };
    await deps.repository.save(proposal);
    return proposal;
  }

  async function create(runId: string, caseId: string): Promise<StepRevisionProposal> {
    const key = `${runId}\0${caseId}`;
    const active = activeCreates.get(key);
    if (active) return active;
    const task = createOnce(runId, caseId).finally(() => activeCreates.delete(key));
    activeCreates.set(key, task);
    return task;
  }

  async function list(runId: string): Promise<StepRevisionProposal[]> {
    const run = await deps.getRun(runId);
    if (!run || run.id !== runId) throw new StepRevisionProposalError("运行记录不存在。", 404);
    const proposals = (await deps.repository.list(run.projectId)).filter(item => item.runId === runId);
    const reconciled: StepRevisionProposal[] = [];
    for (const proposal of proposals) {
      reconciled.push(proposal.status === "pending-review" ? (await reconcileAppliedProposal(proposal)).proposal : proposal);
    }
    return reconciled;
  }

  async function get(id: string): Promise<StepRevisionProposal | undefined> {
    const proposal = await deps.repository.get(id);
    if (!proposal || proposal.status !== "pending-review") return proposal;
    return (await reconcileAppliedProposal(proposal)).proposal;
  }

  async function reconcileAppliedProposal(proposal: StepRevisionProposal): Promise<{ proposal: StepRevisionProposal; project?: DocumentProject }> {
    const project = await deps.getProject(proposal.projectId);
    const adoption = project?.stepRevisionAdoptions?.find(item => item.proposalId === proposal.id);
    if (!project || !adoption || adoption.caseId !== proposal.caseId || adoption.expected !== proposal.expected
      || adoption.currentStepsDigest !== proposal.currentStepsDigest
      || adoption.adoptedStepsDigest !== getStepRevisionDigest(proposal.proposedSteps)
      || !Number.isFinite(Date.parse(adoption.adoptedAt))) {
      return { proposal };
    }

    // The project write is the durable commit marker. If the process stopped
    // before the proposal store was updated, finish that second write on read.
    const recovered = { ...proposal, status: "accepted" as const, reviewedAt: proposal.reviewedAt ?? now() };
    try { await deps.repository.save(recovered); }
    catch {
      throw new StepRevisionProposalError("项目已应用该提案，但审核状态尚未同步；请刷新重试，系统会继续恢复状态。", 500);
    }
    return { proposal: recovered, project };
  }

  async function reviewOnce(id: string, decision: "accept" | "reject"): Promise<{ proposal: StepRevisionProposal; project?: DocumentProject }> {
      let proposal = await deps.repository.get(id);
      if (proposal?.status === "accepted") {
        if (decision === "reject") throw new StepRevisionProposalError("已采纳的提案不能再拒绝。", 409);
        const acceptedProject = await deps.getProject(proposal.projectId);
        return acceptedProject ? { proposal, project: acceptedProject } : { proposal };
      }
      if (proposal?.status === "pending-review") {
        const recovered = await reconcileAppliedProposal(proposal);
        proposal = recovered.proposal;
        if (proposal.status === "accepted") {
          if (decision === "reject") throw new StepRevisionProposalError("该提案已在项目中应用并恢复为已采纳状态，不能再拒绝。", 409);
          return recovered;
        }
      }
      if (!proposal || proposal.status !== "pending-review") throw new StepRevisionProposalError("只有待审核提案可以采纳或拒绝。", 409);
      if (decision === "reject") {
        proposal.status = "rejected";
        proposal.reviewedAt = now();
        await deps.repository.save(proposal);
        return { proposal };
      }
      let current: Awaited<ReturnType<typeof context>>;
      try { current = await context(proposal.runId, proposal.caseId); }
      catch (error) {
        if (error instanceof StepRevisionProposalError && error.status === 409) {
          proposal.status = "stale";
          proposal.reviewedAt = now();
          await deps.repository.save(proposal);
        }
        throw error;
      }
      if (current.project.id !== proposal.projectId || current.investigation.id !== proposal.investigationId
        || current.investigation.runDigest !== proposal.runDigest || current.current.expected !== proposal.expected
        || getStepRevisionDigest(current.current.steps) !== proposal.currentStepsDigest
        || getStepRevisionDigest(proposal.currentSteps) !== proposal.currentStepsDigest) {
        proposal.status = "stale";
        proposal.reviewedAt = now();
        await deps.repository.save(proposal);
        throw new StepRevisionProposalError("项目、脚本、预期或调查事实已变化；该提案已过期，不能采纳。", 409);
      }
      for (const citation of proposal.evidence) {
        if (!current.investigation.facts.some(fact => fact.caseId === proposal.caseId && fact.factId === citation.factId && fact.text.includes(citation.quote))) {
          proposal.status = "stale";
          proposal.reviewedAt = now();
          await deps.repository.save(proposal);
          throw new StepRevisionProposalError("提案引用不再匹配当前同案调查事实；已阻止采纳。", 409);
        }
      }
      let beforeApplication: {
        caseItem: BrowserCheck;
        reviewStatus: DocumentProject["reviewStatus"];
        reviewNotes: string | undefined;
        stepAuthoring: DocumentProject["stepAuthoring"];
        stepRevisionAdoptions: DocumentProject["stepRevisionAdoptions"];
      } | undefined;
      let project: DocumentProject | undefined;
      try { project = await deps.mutateProject(proposal.projectId, latest => {
        const index = latest.cases.findIndex(item => item.id === proposal.caseId);
        const item = latest.cases[index];
        if (!item || item.expected !== proposal.expected || getStepRevisionDigest(item.steps) !== proposal.currentStepsDigest
          || item.sideEffectRisk !== "none" || (item.preconditions?.length && item.preconditionsConfirmed !== true) || !isSafeReadOnlyBrowserCase(item)) {
          throw new StepRevisionProposalError("用例在审核时已经变化或不再满足只读条件。", 409);
        }
        const validated = deps.validateCases([{ ...item, steps: proposal.proposedSteps }])[0];
        if (!validated || validated.expected !== item.expected || !isSafeReadOnlyBrowserCase(validated)) {
          throw new StepRevisionProposalError("提案步骤在采纳时未通过当前校验。", 409);
        }
        beforeApplication = {
          caseItem: structuredClone(item),
          reviewStatus: latest.reviewStatus,
          reviewNotes: latest.reviewNotes,
          stepAuthoring: latest.stepAuthoring ? structuredClone(latest.stepAuthoring) : undefined,
          stepRevisionAdoptions: latest.stepRevisionAdoptions ? structuredClone(latest.stepRevisionAdoptions) : undefined,
        };
        if ((latest.stepRevisionAdoptions ?? []).some(adoption => adoption.proposalId === proposal.id)) {
          throw new StepRevisionProposalError("项目已存在该提案的采纳记录；请刷新提案状态后再操作。", 409);
        }
        latest.cases[index] = { ...item, steps: validated.steps, lifecycleStatus: "draft", selectedForRegression: false };
        latest.reviewStatus = "draft";
        latest.reviewNotes = `已人工采纳步骤修订提案 ${proposal.id}；用例已退出回归选择并转为待审核，尚未复验。`;
        latest.stepRevisionAdoptions = [...(latest.stepRevisionAdoptions ?? []), {
          proposalId: proposal.id,
          caseId: proposal.caseId,
          expected: proposal.expected,
          currentStepsDigest: proposal.currentStepsDigest,
          adoptedStepsDigest: getStepRevisionDigest(validated.steps),
          adoptedAt: now(),
        }];
        delete latest.stepAuthoring;
        latest.updatedAt = now();
      }); } catch (error) {
        if (error instanceof StepRevisionProposalError && error.status === 409) {
          proposal.status = "stale";
          proposal.reviewedAt = now();
          await deps.repository.save(proposal);
        }
        throw error;
      }
      if (!project) throw new StepRevisionProposalError("项目不存在。", 404);
      proposal.status = "accepted";
      proposal.reviewedAt = now();
      try {
        await deps.repository.save(proposal);
      } catch (error) {
        // The project and proposal stores cannot share a transaction. Compensate the
        // project mutation if recording acceptance fails, but only while the exact
        // applied draft is still current so a concurrent edit is never overwritten.
        if (beforeApplication) {
          try {
            await deps.mutateProject(proposal.projectId, latest => {
              const index = latest.cases.findIndex(item => item.id === proposal.caseId);
              const item = latest.cases[index];
              if (!item || getStepRevisionDigest(item.steps) !== getStepRevisionDigest(proposal.proposedSteps)
                || item.lifecycleStatus !== "draft" || item.selectedForRegression !== false
                || latest.reviewNotes !== `已人工采纳步骤修订提案 ${proposal.id}；用例已退出回归选择并转为待审核，尚未复验。`) {
                throw new StepRevisionProposalError("提案状态保存失败；项目已发生后续变化，无法安全回滚，请核对项目与提案状态。", 500);
              }
              latest.cases[index] = structuredClone(beforeApplication!.caseItem);
              if (beforeApplication!.reviewStatus === undefined) delete latest.reviewStatus;
              else latest.reviewStatus = beforeApplication!.reviewStatus;
              if (beforeApplication!.reviewNotes === undefined) delete latest.reviewNotes;
              else latest.reviewNotes = beforeApplication!.reviewNotes;
              if (beforeApplication!.stepAuthoring === undefined) delete latest.stepAuthoring;
              else latest.stepAuthoring = structuredClone(beforeApplication!.stepAuthoring);
              if (beforeApplication!.stepRevisionAdoptions === undefined) delete latest.stepRevisionAdoptions;
              else latest.stepRevisionAdoptions = structuredClone(beforeApplication!.stepRevisionAdoptions);
              latest.updatedAt = now();
            });
          } catch {
            throw new StepRevisionProposalError("提案状态保存失败，且项目补偿回滚失败；请核对项目与提案状态后再操作。", 500);
          }
        }
        proposal.status = "pending-review";
        delete proposal.reviewedAt;
        throw new StepRevisionProposalError("提案状态保存失败；已回滚项目步骤变更，提案仍待审核。", 500);
      }
      return { proposal, project };
  }

  async function review(id: string, decision: "accept" | "reject"): Promise<{ proposal: StepRevisionProposal; project?: DocumentProject }> {
    if (activeReviews.has(id)) throw new StepRevisionProposalError("该提案正在审核中；请刷新状态后再操作。", 409);
    activeReviews.add(id);
    try {
      const initial = await deps.repository.get(id);
      if (!initial) throw new StepRevisionProposalError("只有待审核提案可以采纳或拒绝。", 409);
      const action = () => reviewOnce(id, decision);
      if (initial.status === "accepted") return await action();
      if (initial.status === "pending-review") {
        const recovered = await reconcileAppliedProposal(initial);
        if (recovered.proposal.status === "accepted") {
          if (decision === "reject") throw new StepRevisionProposalError("该提案已在项目中应用并恢复为已采纳状态，不能再拒绝。", 409);
          return recovered;
        }
      }
      if (!deps.repository.withReviewLock) return await action();
      try { return await deps.repository.withReviewLock(initial.projectId, initial.caseId, action); }
      catch (error) {
        if (error && typeof error === "object" && (error as { code?: unknown }).code === "ELOCKED") {
          let lockDetails = "锁状态无法读取";
          try {
            const inspection = await deps.repository.inspectReviewLock?.(initial.projectId, initial.caseId);
            if (inspection) lockDetails = inspection.present ? `检测到锁文件：${inspection.path}` : `未检测到锁文件（检查路径：${inspection.path}）`;
          } catch { /* Keep the original lock conflict actionable even if diagnostics fail. */ }
          throw new StepRevisionProposalError(`该用例审核未能获取互斥锁；${lockDetails}。锁可能由其他服务实例持有，也可能是进程崩溃遗留。系统不会自动回收锁；请确认所有使用该数据目录的 TestPilot 服务均已停止后，由操作人员检查并清理已确认遗留的锁。`, 409);
        }
        throw error;
      }
    } finally { activeReviews.delete(id); }
  }

  return { create, get, list, review };
}
