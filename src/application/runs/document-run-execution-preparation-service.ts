import type { CheckpointRecoveryRequest, DocumentProject, DocumentRun, DocumentRunMode, DocumentRunScopePlan, DocumentSiteVersion, ExecutionJournal } from '../../domain/document-test-model.js';

export interface DocumentRunExecutionPreparationOptions {
  runId?: string | undefined;
  resumeRunId?: string | undefined;
  runMode?: DocumentRunMode | undefined;
  baselineRunId?: string | undefined;
  testDataSetId?: string | undefined;
  parameterValues?: Record<string, string> | undefined;
  selectedCaseIds?: string[] | undefined;
  scopePlan?: DocumentRunScopePlan | undefined;
  siteVersionSnapshot?: DocumentSiteVersion | undefined;
  checkpointRecovery?: CheckpointRecoveryRequest | undefined;
}

export interface DocumentRunExecutionPreparationPorts {
  readJournal(runId: string): Promise<ExecutionJournal>;
  getRun(runId: string): Promise<DocumentRun | undefined>;
  isBaselineEligible(run: DocumentRun): boolean;
  materialVersion(project: DocumentProject): string;
  runIdExists(runId: string): Promise<boolean>;
  createRunId(): string;
  now(): string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }

export function createDocumentRunExecutionPreparationService(ports: DocumentRunExecutionPreparationPorts) {
  return async (project: DocumentProject, options: DocumentRunExecutionPreparationOptions) => {
    const startedAt = ports.now();
    const runId = options.resumeRunId ?? options.runId ?? ports.createRunId();
    let resumedJournal: ExecutionJournal | undefined;
    if (options.resumeRunId) {
      try { resumedJournal = await ports.readJournal(options.resumeRunId); }
      catch { throw new Error('恢复 journal 不存在或不可读；不会按当前全量选择重放用例。'); }
      if (resumedJournal.version !== 1 || resumedJournal.runId !== options.resumeRunId || resumedJournal.projectId !== project.id || !Array.isArray(resumedJournal.selectedCaseIds)) throw new Error('恢复 journal 的身份、项目或用例范围无效；不会重放执行。');
      if (options.runMode !== undefined && options.runMode !== (resumedJournal.runMode ?? 'compare')) throw new Error('恢复请求的执行模式与原运行记录不同；拒绝改变运行模式。');
      if (options.baselineRunId !== undefined && options.baselineRunId !== resumedJournal.baselineRunId) throw new Error('恢复请求的基线运行与 journal 原记录不同；拒绝改变历史比较基线。');
      if (options.testDataSetId !== undefined && options.testDataSetId !== resumedJournal.testDataSetId) throw new Error('恢复请求的数据组与 journal 原记录不同；拒绝改变运行输入。');
      if (options.parameterValues !== undefined && !same(options.parameterValues, resumedJournal.parameterValues ?? {})) throw new Error('恢复请求的参数与 journal 原记录不同；拒绝改变运行输入。');
      if (options.selectedCaseIds !== undefined && !same(options.selectedCaseIds, resumedJournal.selectedCaseIds)) throw new Error('恢复请求的用例范围与 journal 原始范围不同；拒绝扩展或缩小运行范围。');
      if (options.scopePlan !== undefined && !same(options.scopePlan, resumedJournal.scopePlan)) throw new Error('恢复请求的 scopePlan 与 journal 原始范围不同；拒绝改变运行范围。');
      if (options.siteVersionSnapshot !== undefined && !same(options.siteVersionSnapshot, resumedJournal.siteVersionSnapshot)) throw new Error('恢复请求的网站版本与原运行记录不同；拒绝在不同部署版本上续跑。');
      if (options.checkpointRecovery !== undefined && !same(options.checkpointRecovery, resumedJournal.checkpointRecovery)) throw new Error('恢复请求不能替换 journal 中原有的检查点及调查采纳记录。');
      if (resumedJournal.siteVersionSnapshot && project.targetUrl !== resumedJournal.siteVersionSnapshot.targetUrl) throw new Error('恢复项目目标网址与 journal 的网站版本快照不一致；拒绝在其他部署版本上续跑。');
      if (resumedJournal.materialVersion && ports.materialVersion(project) !== resumedJournal.materialVersion) throw new Error('恢复时项目需求/测试资料版本与 journal 快照不一致；拒绝用新资料续跑旧运行。');
    }
    const runMode: DocumentRunMode = resumedJournal?.runMode ?? options.runMode ?? (resumedJournal ? 'compare' : 'regression');
    if (runMode !== 'regression' && runMode !== 'compare') throw new Error('runMode 必须是 regression 或 compare。');
    if (!options.resumeRunId && options.siteVersionSnapshot && project.targetUrl !== options.siteVersionSnapshot.targetUrl) throw new Error('运行目标网址与选择的网站版本不一致；拒绝在未固定的部署版本上启动。');
    const baselineRunId = options.baselineRunId ?? resumedJournal?.baselineRunId;
    const baselineRun = baselineRunId ? await ports.getRun(baselineRunId) : undefined;
    if (baselineRunId && (!baselineRun || baselineRun.projectId !== project.id || !ports.isBaselineEligible(baselineRun))) throw new Error('历史基线必须是同一项目中已完成、范围明确且所选用例均有确定结果的运行。');
    if (!options.resumeRunId && options.runId) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(options.runId)) throw new Error('runId 只允许使用字母、数字、下划线或连字符，长度最多 128。 ');
      if (await ports.runIdExists(options.runId)) throw new Error(`runId 已存在，拒绝覆盖已有执行记录：${options.runId}`);
    }
    return { startedAt: resumedJournal?.startedAt ?? startedAt, runId, runMode, baselineRunId, baselineRun, resumedJournal };
  };
}
