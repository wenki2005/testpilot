import type { DocumentProject } from '../../domain/document-test-model.js';
import { sha256Hex } from '../../domain/sha256.js';
import { AutonomousRegressionPlanError, isAutonomousRegressionPlanGrounded, type AutonomousRegressionPlan } from './document-autonomous-regression-planner.js';

export type SavedAutonomousPlan = {
  id: string; projectId: string; siteVersionId: string; createdAt: string;
  contextDigest: string; targetUrlSnapshot: string; plan: AutonomousRegressionPlan;
  blockers: string[];
};
export interface AutonomousPlanRepository {
  save(record: SavedAutonomousPlan): Promise<void>;
  get(id: string): Promise<SavedAutonomousPlan | undefined>;
  list(projectId: string): Promise<SavedAutonomousPlan[]>;
}
export class AutonomousPlanServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const autonomousPlanContextDigest = (project: DocumentProject) => sha256Hex(JSON.stringify(project));
const contextDigest = autonomousPlanContextDigest;

/** Creates persisted, model-selected plans. It never opens a page or submits a run. */
export function createDocumentAutonomousPlanService(deps: {
  getProject(id: string): Promise<DocumentProject | undefined>;
  planner: { plan(input: { projectId: string; cases: DocumentProject['cases']; changeNotes: string; currentVersion: string }): Promise<AutonomousRegressionPlan> };
  repository: AutonomousPlanRepository;
  createId(): string;
  now(): string;
}) {
  async function getProject(id: string) {
    const project = await deps.getProject(id);
    if (!project) throw new AutonomousPlanServiceError(404, '项目不存在。');
    return project;
  }
  function view(record: SavedAutonomousPlan, project: DocumentProject) {
    const stale = record.contextDigest !== contextDigest(project);
    const version = project.siteVersions?.find(item => item.id === record.siteVersionId);
    const grounded = Boolean(version && isAutonomousRegressionPlanGrounded(record.plan, project.cases, version.changeNotes));
    const blockers = [...record.blockers];
    if (!grounded) blockers.push('该计划缺少可核验的变更说明与用例原文双向引用，请重新生成计划。');
    return { ...structuredClone(record), blockers, validation: stale ? 'stale' as const : 'current' as const,
      executionReadiness: stale || blockers.length || (record.plan.outcome === undefined ? 'selected' : record.plan.outcome) !== 'selected' || !record.plan.orderedCaseIds.length ? 'blocked' as const : 'ready' as const };
  }
  return {
    async create(projectId: string, input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AutonomousPlanServiceError(400, '规划请求必须为对象。');
      const data = input as Record<string, unknown>;
      if (Object.keys(data).some(key => key !== 'siteVersionId') || typeof data.siteVersionId !== 'string' || !data.siteVersionId.trim()) throw new AutonomousPlanServiceError(400, '规划仅接受 siteVersionId，不能由请求指定模型的回归范围。');
      const project = structuredClone(await getProject(projectId));
      const version = project.siteVersions?.find(item => item.id === data.siteVersionId);
      if (!version) throw new AutonomousPlanServiceError(404, '网站版本不属于当前项目。');
      if (!version.changeNotes.trim()) throw new AutonomousPlanServiceError(422, '网站版本需要变更说明才能分析回归范围。');
      const digest = contextDigest(project);
      let plan: AutonomousRegressionPlan;
      try { plan = await deps.planner.plan({ projectId, cases: project.cases, changeNotes: version.changeNotes, currentVersion: version.id }); }
      catch (error) {
        if (error instanceof AutonomousRegressionPlanError) throw new AutonomousPlanServiceError(422, error.message);
        throw new AutonomousPlanServiceError(502, '自主回归评估未能生成有效计划；请检查模型配置后重试。');
      }
      if (digest !== contextDigest(await getProject(projectId))) throw new AutonomousPlanServiceError(409, '分析期间项目、版本或测试数据发生变化，请重新规划。');
      const blockers: string[] = [];
      if (plan.outcome === 'no-relevant-cases') blockers.push('模型未发现相关历史用例；这是规划结论，未执行任何测试。');
      if (plan.outcome === 'needs-clarification') blockers.push('模型判断信息不足，需要补充资料后重新规划。');
      if (project.reviewStatus !== 'approved') blockers.push('项目尚未审核通过。');
      for (const id of plan.orderedCaseIds) {
        const item = project.cases.find(candidate => candidate.id === id)!;
        if (item.lifecycleStatus !== 'runnable') blockers.push(`用例 ${id} 尚未处于可运行状态。`);
        if (item.sideEffectRisk !== 'none') blockers.push(`用例 ${id} 的副作用风险需要明确处理。`);
        if (item.preconditions?.length && !item.preconditionsConfirmed) blockers.push(`用例 ${id} 的文字前置尚未确认。`);
        if (!item.steps?.length) blockers.push(`用例 ${id} 缺少可复用执行步骤。`);
      }
      const record: SavedAutonomousPlan = { id: deps.createId(), projectId, siteVersionId: version.id, createdAt: deps.now(),
        contextDigest: digest, targetUrlSnapshot: version.targetUrl, plan: structuredClone(plan), blockers };
      await deps.repository.save(record);
      return view(record, project);
    },
    async get(projectId: string, id: string) {
      const project = await getProject(projectId);
      const record = await deps.repository.get(id);
      if (!record || record.projectId !== projectId || record.id !== id) throw new AutonomousPlanServiceError(404, '自主回归计划不存在。');
      return view(record, project);
    },
    async list(projectId: string) {
      const project = await getProject(projectId);
      return (await deps.repository.list(projectId)).filter(record => record.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(record => view(record, project));
    },
  };
}
