import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DocumentProject, DocumentRun } from '../../domain/document-test-model.js';
import { createHash } from 'node:crypto';
import { fail, json } from './http-utils.js';
import type { CaseCodeFile } from '../../domain/document-case-code.js';

export async function handleDocumentCaseCodeRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, deps: {
  getProject(id: string): Promise<DocumentProject | undefined>;
  getRun(id: string): Promise<DocumentRun | undefined>;
  readSources(projectId: string, caseId: string): Promise<CaseCodeFile[]>;
}): Promise<boolean> {
  const match = pathname.match(/^\/api\/(document-projects|document-runs)\/([^/]+)\/cases\/([^/]+)\/code$/u);
  if (!match) return false;
  if (req.method !== 'GET') { fail(res, 405, '代码查看仅支持读取。'); return true; }
  let ownerId: string, caseId: string;
  try { ownerId = decodeURIComponent(match[2]!); caseId = decodeURIComponent(match[3]!); }
  catch { fail(res, 400, '用例标识编码无效。'); return true; }
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(ownerId) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(caseId)) { fail(res, 400, '用例标识无效。'); return true; }
  try {
    const historical = match[1] === 'document-runs';
    const run = historical ? await deps.getRun(ownerId) : undefined;
    const project = !historical ? await deps.getProject(ownerId) : undefined;
    if (historical ? !run : !project) { fail(res, 404, '项目或运行不存在。'); return true; }
    if (run?.caseScope && !run.caseScope.selectedCaseIds.includes(caseId)) { fail(res, 404, '此用例未纳入该轮执行范围。'); return true; }
    // Never replace a missing historical snapshot with today's edited project.
    const snapshots = run?.executionCaseSnapshots ?? run?.caseSnapshots;
    const check = (historical ? snapshots : project?.cases)?.find(item => item.id === caseId);
    if (!check) { fail(res, 404, historical ? '本轮没有此用例的代码快照，不能用当前版本代替。' : '项目中没有此用例。'); return true; }
    const code = JSON.stringify(check, null, 2);
    const sha256 = createHash('sha256').update(code).digest('hex');
    const files: CaseCodeFile[] = [{ name: `${caseId}.json`, language: 'json', code, sha256,
      description: historical ? run?.executionCaseSnapshots ? '本轮执行快照；包括已保存的步骤、断言、入口和依赖。' : '本轮冻结的原始用例定义；未提供解析后步骤，不以当前版本代替。' : '当前已保存的用例定义；尚未保存的编辑不在此版本内。' },
      ...await deps.readSources(run?.projectId ?? project!.id, caseId)];
    res.setHeader('cache-control', 'no-store');
    json(res, 200, { caseId, title: check.title, origin: historical ? '运行快照' : '当前已保存版本',
      runId: run?.id, version: run?.caseVersion ?? sha256, files,
      notice: 'TestPilot 按用例定义解释执行。执行器和关联业务源码为当前本机代码，不冒充历史运行时的源码版本；查看、复制和下载均不会运行测试。' });
  } catch { fail(res, 500, '无法读取用例代码，请稍后重试。'); }
  return true;
}
