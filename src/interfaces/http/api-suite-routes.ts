import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, documentBody, fail, json } from './http-utils.js';
import type * as ApiWorkflow from '../../adapters/api-suite-workflow.js';
import type * as ApiAuthoring from '../../adapters/api-suite-authoring.js';
import type * as ExampleSearch from '../../adapters/test-example-search.js';
import type * as OpenApiSummary from '../../adapters/openapi-summary.js';
import type { ImportedDocument } from '../../adapters/document-importer.js';

export interface ApiSuiteRouteDependencies {
  listCandidates: typeof ApiWorkflow.listApiSuiteCandidates;
  createCandidate: typeof ApiWorkflow.createApiSuiteCandidate;
  updateCandidate: typeof ApiWorkflow.updateApiSuiteCandidate;
  reviewCandidate: typeof ApiWorkflow.reviewApiSuiteCandidate;
  getCandidate: typeof ApiWorkflow.getApiSuiteCandidate;
  getFindingHistory: typeof ApiWorkflow.getApiFindingHistory;
  diagnoseFinding: typeof ApiWorkflow.diagnoseApiFinding;
  executeApproved: typeof ApiWorkflow.executeApprovedApiSuite;
  autoRunReadOnly: typeof ApiWorkflow.autoRunReadOnlyApiSuite;
  readRunArtifact: typeof ApiWorkflow.readApiRunArtifact;
  getRun: typeof ApiWorkflow.getApiRun;
  generateSuite: typeof ApiAuthoring.generateApiSuite;
  extractDocument(fileName: string, bytes: Buffer): Promise<ImportedDocument>;
  searchExamples: typeof ExampleSearch.searchTestExamples;
  summarizeOpenApi: typeof OpenApiSummary.summarizeOpenApiSpecification;
  openApiOperationFacts: typeof OpenApiSummary.openApiOperationFacts;
  publicSearchDisabled(): boolean;
}

/** HTTP adapter for API contract candidates, their execution, and retained evidence. */
export async function handleApiSuiteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: ApiSuiteRouteDependencies,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/api-suites') { json(res, 200, await deps.listCandidates()); return true; }

  if (req.method === 'POST' && pathname === '/api/api-suites') {
    let data: any;
    try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    try { json(res, 201, await deps.createCandidate(data)); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : 'API suite 无效。'); }
    return true;
  }

  const update = pathname.match(/^\/api\/api-suites\/([^/]+)\/update$/u);
  if (req.method === 'POST' && update) {
    let data: any;
    try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || !Object.hasOwn(data, 'suite')) { fail(res, 400, 'update requires exactly one suite field.'); return true; }
    try { json(res, 200, await deps.updateCandidate(decodeURIComponent(update[1]!), data.suite)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : 'API suite 修订失败。'); }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/api-suites/generate') {
    let data: any;
    try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    const allowed = new Set(['baseUrl', 'contextText', 'apiSpecification', 'files']);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key)) || typeof data.baseUrl !== 'string' || data.baseUrl.length > 2000 || (data.contextText !== undefined && (typeof data.contextText !== 'string' || data.contextText.length > 20_000)) || (data.apiSpecification !== undefined && (typeof data.apiSpecification !== 'string' || data.apiSpecification.length > 40_000))) {
      fail(res, 400, 'API 用例生成请求字段无效或超过长度限制。'); return true;
    }
    const files: Array<{ fileName: string; bytesBase64: string }> = data.files ?? [];
    if (!Array.isArray(files) || files.length > 5 || files.some(file => !file || typeof file.fileName !== 'string' || typeof file.bytesBase64 !== 'string' || file.bytesBase64.length > 13_000_000)) {
      fail(res, 400, '资料需为 1–5 个 PDF、XMind、Markdown 或 TXT 文件，每个不超过 9 MB。'); return true;
    }
    try {
      const documents = await Promise.all(files.map(async file => {
        const bytes = Buffer.from(file.bytesBase64, 'base64');
        if (!bytes.length || bytes.length > 9 * 1024 * 1024) throw new Error(`${file.fileName} 不能为空且不能超过 9 MB。`);
        return { fileName: file.fileName, document: await deps.extractDocument(file.fileName, bytes) };
      }));
      const sourceRequirements = [typeof data.contextText === 'string' ? data.contextText.trim() : '', ...documents.map(item => `资料：${item.fileName}\n${item.document.text}`)].filter(Boolean).join('\n\n').slice(0, 20_000);
      const apiSpecification = typeof data.apiSpecification === 'string' ? data.apiSpecification.trim().slice(0, 40_000) : '';
      if (!sourceRequirements && !apiSpecification) { fail(res, 400, '请提供 API 需求资料、补充说明或 OpenAPI 契约。'); return true; }
      const hostname = new URL(data.baseUrl).hostname;
      const researchPromise = deps.publicSearchDisabled()
        ? Promise.resolve({ provider: 'none' as const, notice: '公开案例搜索已关闭。', results: [] })
        : deps.searchExamples(`${hostname} API endpoint testing authentication validation test cases`, { limit: 5, timeoutMs: 15_000 }).catch(() => ({ provider: 'none' as const, notice: '公开案例搜索不可用。', results: [] }));
      const [research] = await Promise.all([researchPromise]);
      const suite = await deps.generateSuite(data.baseUrl, sourceRequirements, apiSpecification, research.results);
      suite.description = [suite.description, `来源资料文件：${documents.map(item => item.fileName).join('、') || '无'}`, `公开案例检索：${research.results.length} 条（仅参考测试覆盖，不作为目标 API 行为依据）`].filter(Boolean).join('\n').slice(0, 2000);
      const summary = await deps.summarizeOpenApi(apiSpecification);
      const openApiOperations = summary?.operations.map(operation => `${String(operation.method)} ${String(operation.path)}`);
      const candidate = await deps.createCandidate(suite, { automaticReadOnlyRun: true, ...(openApiOperations ? { openApiOperations, openApiOperationFacts: deps.openApiOperationFacts(summary!) } : {}) });
      json(res, 201, { ...candidate, research: { count: research.results.length, provider: research.provider, notice: research.notice } });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : 'API 测试套件生成失败。'); }
    return true;
  }

  const review = pathname.match(/^\/api\/api-suites\/([^/]+)\/review$/u);
  if (req.method === 'POST' && review) {
    let data: any;
    try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || !['approve', 'reject'].includes(data.decision) || typeof data.notes !== 'string' || data.notes.length > 2000) { fail(res, 400, '审核需要 decision=approve/reject 和不超过 2000 字的 notes。'); return true; }
    try { json(res, 200, await deps.reviewCandidate(decodeURIComponent(review[1]!), data.decision, data.notes)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : 'API suite 审核失败。'); }
    return true;
  }

  const findingDiagnosis = pathname.match(/^\/api\/api-suites\/([^/]+)\/findings\/([^/]+)\/diagnosis$/u);
  if (req.method === 'GET' && findingDiagnosis) {
    const diagnosis = await deps.diagnoseFinding(decodeURIComponent(findingDiagnosis[1]!), decodeURIComponent(findingDiagnosis[2]!));
    diagnosis ? json(res, 200, diagnosis) : fail(res, 404, 'API finding 或套件不存在。');
    return true;
  }

  const findings = pathname.match(/^\/api\/api-suites\/([^/]+)\/findings$/u);
  if (req.method === 'GET' && findings) {
    const history = await deps.getFindingHistory(decodeURIComponent(findings[1]!));
    history ? json(res, 200, history) : fail(res, 404, 'API suite 候选不存在或校验失败。');
    return true;
  }

  const run = pathname.match(/^\/api\/api-suites\/([^/]+)\/run$/u);
  if (req.method === 'POST' && run) {
    let data: any;
    try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    const allowed = new Set(['baseUrl', 'allowNetwork', 'allowMutations', 'allowConcurrency', 'caseIds', 'rerunOf']);
    const validIds = data?.caseIds === undefined || (Array.isArray(data.caseIds) && data.caseIds.length > 0 && data.caseIds.length <= 500 && data.caseIds.every((id: unknown) => typeof id === 'string' && id.length <= 120 && id.trim()) && new Set(data.caseIds).size === data.caseIds.length);
    const validParent = data?.rerunOf === undefined || (typeof data.rerunOf === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(data.rerunOf));
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key)) || (data.baseUrl !== undefined && typeof data.baseUrl !== 'string') || ['allowNetwork', 'allowMutations', 'allowConcurrency'].some(key => data[key] !== undefined && typeof data[key] !== 'boolean') || !validIds || !validParent || (data.rerunOf !== undefined && data.caseIds === undefined)) { fail(res, 400, 'API run options are invalid.'); return true; }
    try { json(res, 201, (await deps.executeApproved(decodeURIComponent(run[1]!), data)).record); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : 'API suite 执行失败。'); }
    return true;
  }

  const autoRun = pathname.match(/^\/api\/api-suites\/([^/]+)\/auto-run$/u);
  if (req.method === 'POST' && autoRun) {
    let data: any;
    try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => key !== 'allowNetwork') || (data.allowNetwork !== undefined && typeof data.allowNetwork !== 'boolean')) { fail(res, 400, 'API auto-run options are invalid.'); return true; }
    try {
      const id = decodeURIComponent(autoRun[1]!);
      const result = await deps.autoRunReadOnly(id, data);
      json(res, 201, { candidate: await deps.getCandidate(id), run: result.record });
    } catch (error) { fail(res, 409, error instanceof Error ? error.message : 'API suite 自动运行失败。'); }
    return true;
  }

  const artifactRoute = pathname.match(/^\/api\/api-runs\/([^/]+)\/(report|package)$/u);
  if (req.method === 'GET' && artifactRoute) {
    const id = decodeURIComponent(artifactRoute[1]!);
    const name = artifactRoute[2] === 'report' ? 'report.md' : 'testpilot-api-suite.zip';
    const artifact = await deps.readRunArtifact(id, name);
    if (!artifact) { fail(res, 404, 'API run artifact 不存在。'); return true; }
    const zip = name.endsWith('.zip');
    res.writeHead(200, { 'content-type': zip ? 'application/zip' : 'text/markdown; charset=utf-8', 'content-length': artifact.length, 'content-disposition': `attachment; filename="testpilot-${id}.${zip ? 'zip' : 'md'}"`, 'cache-control': 'no-store' });
    res.end(artifact);
    return true;
  }

  const apiRun = pathname.match(/^\/api\/api-runs\/([^/]+)$/u);
  if (req.method === 'GET' && apiRun) {
    const record = await deps.getRun(decodeURIComponent(apiRun[1]!));
    record ? json(res, 200, record) : fail(res, 404, 'API run 不存在。');
    return true;
  }

  const candidate = pathname.match(/^\/api\/api-suites\/([^/]+)$/u);
  if (req.method === 'GET' && candidate) {
    const result = await deps.getCandidate(decodeURIComponent(candidate[1]!));
    result ? json(res, 200, result) : fail(res, 404, 'API suite 候选不存在或校验失败。');
    return true;
  }

  return false;
}
