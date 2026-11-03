import type { CheckpointRecoveryRequest, DocumentProject, DocumentRun, DocumentRunMode, DocumentSiteVersion } from '../../domain/document-test-model.js';
import { planCheckpointRecovery } from '../../domain/document-checkpoint-recovery-integrity.js';
import { getDocumentRunInvestigationFactSnapshot } from './document-run-investigation-service.js';
import { automaticRecoveryParentStopReason } from './document-automatic-recovery-policy.js';

export type { CheckpointRecoveryRequest } from '../../domain/document-test-model.js';

/** Recheck the durable recovery proof while the executor owns its browser lease. */
export function assertCheckpointRecoveryStart(input: {
  latestProject: DocumentProject | undefined;
  executionProject: DocumentProject;
  parent: DocumentRun | undefined;
  request: CheckpointRecoveryRequest;
  parentRunId?: string | undefined;
  selectedCaseIds: string[];
  runMode: DocumentRunMode;
  targetUrl: string;
  siteVersionSnapshot?: DocumentSiteVersion | undefined;
  testDataSetId?: string | undefined;
  parameterValues: Record<string, string>;
  redactText?: (text: string) => string;
}) {
  const { latestProject, parent, request } = input;
  if (!latestProject || !parent || parent.id !== request.parentRunId || input.parentRunId !== request.parentRunId) throw new Error('恢复提交的父运行或项目已经不可用，拒绝打开目标页面。');
  const recovery = planCheckpointRecovery(latestProject, parent, request.caseId, request.stepIndex);
  const frozenRecovery = planCheckpointRecovery(input.executionProject, parent, request.caseId, request.stepIndex);
  if (JSON.stringify(recovery.orderedCaseIds) !== JSON.stringify(input.selectedCaseIds)
    || JSON.stringify(frozenRecovery.orderedCaseIds) !== JSON.stringify(input.selectedCaseIds)) throw new Error('恢复提交的执行范围与原检查点重建范围不一致，拒绝打开目标页面。');
  const target = parent.siteVersionSnapshot?.targetUrl ?? parent.targetUrlSnapshot;
  if (!target || input.targetUrl !== target || input.runMode !== (parent.runMode ?? 'compare')
    || JSON.stringify(input.siteVersionSnapshot) !== JSON.stringify(parent.siteVersionSnapshot)
    || input.testDataSetId !== parent.testDataSetId) throw new Error('恢复提交的目标、模式、版本或数据组与父运行不一致，拒绝打开目标页面。');
  for (const [name, value] of Object.entries(input.parameterValues)) {
    if (!Object.hasOwn(parent.parameterValues ?? {}, name) || parent.parameterValues?.[name] !== value) throw new Error('恢复提交的已解析参数与父运行历史值不一致，拒绝打开目标页面。');
  }
  const adopted = request.adoptedAdvice;
  if (request.trigger === 'automatic-policy') {
    if (!adopted || automaticRecoveryParentStopReason(parent) || [latestProject, input.executionProject].some(project => project.apiContract?.allowNetwork || project.apiContract?.allowMutations || project.apiContract?.allowConcurrency)) throw new Error('自动恢复策略条件或 API 权限已变化，拒绝打开目标页面。');
  }
  if (adopted) {
    const snapshot = getDocumentRunInvestigationFactSnapshot(parent, input.redactText ?? (text => text));
    const facts = new Map(snapshot.facts.map(fact => [fact.factId, fact]));
    if (adopted.caseId !== request.caseId || adopted.category !== 'environment' || adopted.strategy !== 'rebuild-readonly-case'
      || typeof adopted.recordId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(adopted.recordId)
      || adopted.runDigest !== snapshot.runDigest || typeof adopted.summary !== 'string' || !adopted.summary.trim()
      || typeof adopted.adoptedAt !== 'string' || !Number.isFinite(Date.parse(adopted.adoptedAt)) || Date.parse(adopted.adoptedAt) < Date.parse(parent.completedAt) || Date.parse(adopted.adoptedAt) > Date.now()
      || !Array.isArray(adopted.evidence) || !adopted.evidence.length || adopted.evidence.some(ref => {
        const fact = ref && facts.get(ref.factId);
        return !fact || fact.caseId !== request.caseId || typeof ref.quote !== 'string' || !ref.quote.trim() || !fact.text.includes(ref.quote);
      })) throw new Error('恢复采纳的调查建议与父运行当前事实不一致或记录无效，拒绝打开目标页面。');
  }
}
