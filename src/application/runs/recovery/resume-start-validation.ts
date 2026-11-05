import type { DocumentProject, DocumentRunMode, DocumentRunScopePlan, DocumentSiteVersion, ExecutionJournal } from '../../../domain/documents/shared/test-model.js';
import { projectMatchesExecutionJournal } from '../execution/lifecycle-service.js';

export interface ResumeStartValidationInput {
  journal: ExecutionJournal;
  latestProject: DocumentProject | undefined;
  executionProject: DocumentProject | undefined;
  runMode?: DocumentRunMode | undefined;
  selectedCaseIds?: string[] | undefined;
  scopePlan?: DocumentRunScopePlan | undefined;
  baselineRunId?: string | undefined;
  testDataSetId?: string | undefined;
  parameterValues?: Record<string, string> | undefined;
  siteVersionSnapshot?: DocumentSiteVersion | undefined;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function supplied<T extends object, K extends keyof T>(object: T, key: K): boolean { return Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined; }

export function assertResumeExecutionJournalIntegrity(input: ResumeStartValidationInput): void {
  const { journal, latestProject, executionProject } = input;
  if (!latestProject) throw new Error('恢复时最新项目无法读取；拒绝续跑。');
  if (!executionProject) throw new Error('恢复执行项目无法读取；拒绝续跑。');
  if (!projectMatchesExecutionJournal(latestProject, journal)) throw new Error('恢复时最新项目的审核、资产、网站版本或档案与 journal 快照不一致；拒绝续跑。');
  if (!projectMatchesExecutionJournal(executionProject, journal) || executionProject.targetUrl !== journal.targetUrl) throw new Error('恢复执行项目的审核、资产或目标网址与 journal 快照不一致；拒绝续跑。');
  if (supplied(input, 'runMode') && input.runMode !== (journal.runMode ?? 'compare')) throw new Error('恢复请求的执行模式与原运行记录不同；拒绝改变运行模式。');
  if (supplied(input, 'selectedCaseIds') && !same(input.selectedCaseIds, journal.selectedCaseIds)) throw new Error('恢复请求的用例范围与 journal 原始范围不同；拒绝扩展或缩小运行范围。');
  if (supplied(input, 'scopePlan') && !same(input.scopePlan, journal.scopePlan)) throw new Error('恢复请求的 scopePlan 与 journal 原始范围不同；拒绝改变运行范围。');
  if (supplied(input, 'baselineRunId') && input.baselineRunId !== journal.baselineRunId) throw new Error('恢复请求的基线运行与 journal 原记录不同；拒绝改变历史比较基线。');
  if (supplied(input, 'testDataSetId') && input.testDataSetId !== journal.testDataSetId) throw new Error('恢复请求的数据组与 journal 原记录不同；拒绝改变运行输入。');
  if (supplied(input, 'parameterValues') && !same(input.parameterValues ?? {}, journal.parameterValues ?? {})) throw new Error('恢复请求的参数与 journal 原记录不同；拒绝改变运行输入。');
  if (supplied(input, 'siteVersionSnapshot') && !same(input.siteVersionSnapshot, journal.siteVersionSnapshot)) throw new Error('恢复请求的网站版本与原运行记录不同；拒绝在不同部署版本上续跑。');
}
