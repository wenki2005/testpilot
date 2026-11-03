import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { bodyJson, fail, json } from './http-utils.js';
import type { SourceTestJob as SourceTestJobContract, SourceTestMode } from '../../domain/source-test.js';
import type { SourceTestJobStore } from '../../application/source-test-job-service.js';
import type { ProjectProfileSummary } from '../../domain/project-profile.js';

export type SourceTestJob = SourceTestJobContract;

export interface SourceTestRouteDependencies {
  jobs: SourceTestJobStore;
  profiles: ProjectProfileSummary[];
  loadProfile(profileId: string): Promise<{ sourceRoot: string }>;
  loadResume(path: string): Promise<{ goal: string; mode: SourceTestMode; sourceRoot: string; candidateFiles: string[] }>;
  containsCredentialLikeValue(value: string): boolean;
  outputRoot: string;
  importCandidate(profileId: string, candidate: { runId: string; candidateDigest: string; runtimeConclusion: string; suite: any; files: Record<string, string>; sourceProvenance: import('../../domain/project-script.js').SourceScriptProvenance }): Promise<unknown>;
}

/** HTTP adapter for source test jobs and continuation of saved source-test results. */
export async function handleSourceTestRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: SourceTestRouteDependencies,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/source-test-jobs') {
    json(res, 200, { provider: 'testpilot-pi-agent', authentication: 'Uses TestPilot model settings; no Codex login or executable.', profiles: deps.profiles, jobs: deps.jobs.list().reverse() });
    return true;
  }

  const candidate = pathname.match(/^\/api\/source-test-jobs\/([0-9a-f-]{36})\/candidate$/iu);
  if (req.method === 'GET' && candidate) {
    try { json(res, 200, await loadCandidate(candidate[1]!, deps)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : '候选当前不可关联，请保留为未关联待审。'); }
    return true;
  }
  const adoption = pathname.match(/^\/api\/source-test-jobs\/([0-9a-f-]{36})\/import$/iu);
  if (req.method === 'POST' && adoption) {
    try {
      const data = await bodyJson(req);
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length) { fail(res, 400, '导入不接受客户端路径或候选内容。'); return true; }
      const value = await loadCandidate(adoption[1]!, deps);
      const script = await deps.importCandidate(value.profileId, { runId: value.provenance.runId, candidateDigest: value.provenance.candidateDigest, runtimeConclusion: value.provenance.runtimeConclusion, sourceProvenance: value.provenance, suite: { version: 1, name: `Source Agent run ${value.provenance.runId}`, cases: value.cases }, files: value.files });
      json(res, 201, script);
    } catch (error) { fail(res, 409, error instanceof Error ? error.message : '候选无法导入。'); }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/source-test-jobs') {
    let data: any;
    try { data = await bodyJson(req); }
    catch { fail(res, 400, '无效的测试任务。'); return true; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['profileId', 'goal', 'mode'].includes(key)) || typeof data.profileId !== 'string' || !deps.profiles.some(profile => profile.id === data.profileId) || typeof data.goal !== 'string' || !data.goal.trim() || data.goal.length > 30_000 || !['plan', 'generate', 'diagnose'].includes(data.mode)) {
      fail(res, 400, '请选择已注册项目，并填写测试目标和有效模式。'); return true;
    }
    if (deps.containsCredentialLikeValue(data.goal)) { fail(res, 422, '目标中疑似含凭据，请使用测试角色或环境变量引用。'); return true; }
    if (deps.jobs.activeCount()) { fail(res, 409, '已有源码测试任务正在运行，请等待完成或停止。'); return true; }
    const profile = await deps.loadProfile(data.profileId);
    json(res, 202, deps.jobs.launch(data.profileId, data.goal, data.mode, profile.sourceRoot));
    return true;
  }

  const resume = pathname.match(/^\/api\/source-test-jobs\/([0-9a-f-]{36})\/resume$/iu);
  if (req.method === 'POST' && resume) {
    const previous = deps.jobs.get(resume[1]!);
    if (!previous?.result) { fail(res, 404, '没有可继续的任务产物。'); return true; }
    if (deps.jobs.activeCount()) { fail(res, 409, '已有源码任务正在执行。'); return true; }
    try {
      const input = req.headers['content-length'] ? await bodyJson(req) : {};
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'feedback') || ((input as { feedback?: unknown }).feedback !== undefined && (typeof (input as { feedback?: unknown }).feedback !== 'string' || ((input as { feedback: string }).feedback.length > 10_000)))) {
        fail(res, 400, '继续任务的补充说明无效。'); return true;
      }
      const feedback = (input as { feedback?: string }).feedback ?? '';
      if (deps.containsCredentialLikeValue(feedback)) { fail(res, 422, '补充说明中疑似含凭据。'); return true; }
      const resumed = await deps.loadResume(path.join(path.dirname(previous.result.reportPath), 'run.json'));
      if (feedback.trim()) resumed.goal += `\nUser continuation feedback:\n${feedback.trim()}`;
      if (resumed.goal.length > 30_000) { fail(res, 422, '补充后的测试目标超过长度限制。'); return true; }
      if (!resumed.goal) { fail(res, 422, '旧版产物没有保留测试目标，请创建新任务。'); return true; }
      json(res, 202, deps.jobs.launch(previous.profileId, resumed.goal, resumed.mode, resumed.sourceRoot, resumed.candidateFiles));
    } catch { fail(res, 422, '任务副本不可继续，请检查已保存的产物。'); }
    return true;
  }

  const cancel = pathname.match(/^\/api\/source-test-jobs\/([0-9a-f-]{36})\/cancel$/iu);
  if (req.method === 'POST' && cancel) {
    const job = deps.jobs.get(cancel[1]!);
    if (!job) { fail(res, 404, '测试任务不存在。'); return true; }
    deps.jobs.cancel(job.id);
    json(res, 200, { id: job.id, cancellationRequested: true });
    return true;
  }

  return false;
}

async function loadCandidate(id: string, deps: SourceTestRouteDependencies): Promise<any> {
  const job = deps.jobs.get(id);
  if (!job?.result || job.mode !== 'generate' || job.status !== 'candidate' || job.result.status !== 'candidate' || job.result.executionState !== 'completed') throw new Error('没有当前可验证的源码测试候选；过期引用保持未关联待审。');
  const result = job.result;
  const root = await realpath(deps.outputRoot);
  const report = path.resolve(result.reportPath);
  const folder = path.dirname(report);
  if (!folder.startsWith(`${root}${path.sep}`) || path.basename(folder) !== result.id) throw new Error('候选证据目录不属于本地受控任务目录。');
  const runFile = path.join(folder, 'run.json'), suiteFile = path.join(folder, 'suite.candidate.json');
  for (const file of [runFile, suiteFile]) { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || !(await realpath(file)).startsWith(`${root}${path.sep}`)) throw new Error('候选证据文件不安全。'); }
  const savedRun = await readFile(runFile, 'utf8').then(JSON.parse);
  if (savedRun.id !== result.id || !['passed', 'failed'].includes(result.runtimeStatus) || !deps.profiles.some(profile => profile.id === job.profileId)) throw new Error('候选来源摘要或项目绑定无法验证。');
  const files: Record<string, string> = {};
  const digests = result.candidateFileDigests ?? {};
  if (JSON.stringify(digests) !== JSON.stringify(savedRun.candidateFileDigests ?? {}) || savedRun.candidateFilesDigest !== result.candidateFilesDigest) throw new Error('任务记录与磁盘摘要不一致。');
  const names = Object.keys(digests).sort();
  if (!names.length) throw new Error('候选文件清单无效。');
  const workspace = path.resolve(result.workspacePath);
  if (workspace !== path.join(folder, 'workspace') || (await realpath(workspace)) !== workspace) throw new Error('候选工作区不属于任务证据目录或含链接。');
  const cases = names.map((file, index) => ({ id: `source-${result.id.slice(0, 8)}-${index + 1}`, title: `Node regression: ${file}`, file, fileDigest: digests[file], command: { bin: 'node', args: ['--test', file], cleanEnvironment: true, timeoutMs: 120000 } }));
  for (const name of names) {
    if (!/^(tests|specs|e2e)\/.*\.(?:[cm]?js)$/.test(name) || name.includes('..') || name.includes('\\')) throw new Error('候选文件路径不安全。');
    const latest = [...(result.executions ?? [])].reverse().find((execution: any) => execution.files?.includes(name));
    if (!latest || !['passed', 'failed'].includes(latest.status)) throw new Error('候选文件没有可判读的真实TAP执行证据。');
    const persistedLatest = [...(savedRun.executions ?? [])].reverse().find((execution: any) => execution.files?.includes(name));
    if (!persistedLatest || persistedLatest.id !== latest.id || persistedLatest.status !== latest.status) throw new Error('候选执行证据与磁盘运行记录不一致。');
    let file = workspace;
    for (const segment of name.split('/')) { file = path.join(file, segment); const part = await lstat(file); if (part.isSymbolicLink()) throw new Error('候选源码路径包含链接。'); }
    const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || !(await realpath(file)).startsWith(`${workspace}${path.sep}`)) throw new Error('候选源码不是普通文件。');
    const content = await readFile(file, 'utf8');
    if (deps.containsCredentialLikeValue(content)) throw new Error('候选源码疑似包含凭据或敏感值，已阻断预览/导入。');
    if (createHash('sha256').update(content).digest('hex') !== digests[name]) throw new Error('候选源码内容与实际执行摘要不符。');
    files[name] = content;
  }
  if (createHash('sha256').update(JSON.stringify(digests)).digest('hex') !== result.candidateFilesDigest) throw new Error('候选文件全集摘要不符。');
  const evidenceIds = [...new Set([...(result.evidenceIds ?? []), ...(result.executions ?? []).map(execution => execution.evidenceId)])];
  const findings = (result.assessment?.findings ?? []).map(finding => {
    const evidenceRefs = [...finding.evidence.matchAll(/\b(?:tool-\d+|execution-\d+)\b/g)].map(match => match[0]).filter((value, index, values) => values.indexOf(value) === index && evidenceIds.includes(value));
    return { caseId: finding.caseId, status: finding.status, evidenceDescription: finding.evidence, evidenceRefs, evidenceLinkStatus: evidenceRefs.length ? 'linked' : 'unlinked-pending-review' };
  });
  return { profileId: job.profileId, files, cases, provenance: { runId: result.id, candidateDigest: result.candidateFilesDigest, runtimeConclusion: result.runtimeStatus, assessmentSummary: result.assessment?.summary ?? 'Assessment summary unavailable; requires review.', blockers: [...(result.assessment?.blockers ?? [])], executions: result.executions, evidenceIds, findings } };
}
