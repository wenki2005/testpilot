import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createExecutionDraftFromCaseGeneration } from '../../adapters/case-generation-handoff.js';
import type { ImportedDocument } from '../../adapters/document-importer.js';
import type { generateTestCaseDrafts } from '../../adapters/case-generation-agent.js';
import type { searchTestExamples } from '../../adapters/test-example-search.js';
import type { readPublicWebsiteText } from '../../adapters/public-page-reader.js';
import type { DocumentProject } from '../../domain/document-test-model.js';
import { documentBody, fail, json } from './http-utils.js';

export interface CaseGenerationRouteDependencies {
  extractDocument(fileName: string, bytes: Buffer): Promise<ImportedDocument>;
  generateDrafts: typeof generateTestCaseDrafts;
  readPublicWebsiteText: typeof readPublicWebsiteText;
  searchExamples: typeof searchTestExamples;
  publicSearchDisabled(): boolean;
  ensureProjectWorkflow(project: DocumentProject): Promise<{ workflowId: string }>;
}

/** HTTP adapter for generating case drafts and handing them to a review project. */
export async function handleCaseGenerationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: CaseGenerationRouteDependencies,
): Promise<boolean> {
  if (req.method === 'POST' && pathname === '/api/case-generator/generate') {
    let data: any;
    try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    const allowed = new Set(['requirementsText', 'websiteUrl', 'websiteText', 'files', 'maxCases', 'searchExamples']);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key))) { fail(res, 400, '用例生成请求字段无效。'); return true; }
    if (typeof data.requirementsText === 'string' && data.requirementsText.length > 60_000 || typeof data.websiteText === 'string' && data.websiteText.length > 30_000 || typeof data.websiteUrl === 'string' && data.websiteUrl.length > 2_000) { fail(res, 400, '说明文字或网址超过长度限制。'); return true; }
    if (data.maxCases !== undefined && (!Number.isInteger(data.maxCases) || data.maxCases < 1 || data.maxCases > 80)) { fail(res, 400, '新增候选用例数量需为 1–80 的整数。'); return true; }
    if (data.websiteUrl) { try { const parsed = new URL(data.websiteUrl); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); } catch { fail(res, 400, '网站地址必须是有效的 HTTP 或 HTTPS 网址。'); return true; } }
    const files: Array<{ fileName: string; bytesBase64: string; role?: string }> = data.files ?? [];
    if (!Array.isArray(files) || files.length > 5 || files.some(file => !file || typeof file.fileName !== 'string' || typeof file.bytesBase64 !== 'string' || file.bytesBase64.length > 13_000_000 || (file.role !== undefined && !['auto', 'requirements', 'coverage-reference', 'held-out-benchmark'].includes(file.role)))) { fail(res, 400, '资料需为最多 5 个 PDF、XMind、Markdown 或 TXT 文件，每个不超过 9 MB；用途必须是 auto/requirements/coverage-reference/held-out-benchmark。'); return true; }
    try {
      const imported = await Promise.all(files.map(async file => {
        const bytes = Buffer.from(file.bytesBase64, 'base64');
        if (!bytes.length || bytes.length > 9 * 1024 * 1024) throw new Error(`${file.fileName} 不能为空且不能超过 9 MB。`);
        return { fileName: file.fileName, requestedRole: file.role ?? 'auto', document: await deps.extractDocument(file.fileName, bytes) };
      }));
      const classified = imported.map(file => ({ ...file, role: file.requestedRole === 'auto' ? (file.document.testCases?.length ? 'held-out-benchmark' : 'requirements') : file.requestedRole }));
      for (const file of classified) {
        if (file.role === 'requirements' && file.document.testCases?.length) throw new Error(`文件「${file.fileName}」同时包含可识别用例和需求用途。为防止留出用例泄漏进生成提示，请拆分需求文本与基准，或将此文件标记为留出基准。`);
        if (file.role === 'held-out-benchmark' && !file.document.testCases?.length) throw new Error(`文件「${file.fileName}」标记为留出基准，但没有识别到可比较的用例；请检查格式或改选覆盖参考。`);
      }
      const requirementParts = [typeof data.requirementsText === 'string' ? data.requirementsText.trim() : '', ...classified.filter(file => file.role === 'requirements').map(file => `资料：${file.fileName}\n${file.document.text}`)].filter(Boolean);
      const requirementsText = requirementParts.join('\n\n---\n\n');
      if (requirementsText.length > 40_000) throw new Error(`需求资料合计 ${requirementsText.length} 字符，单轮上限 40000；请按功能章节分批提交。未截断或静默漏测。`);
      const websiteUrl = typeof data.websiteUrl === 'string' ? data.websiteUrl.trim() : '';
      const hostname = websiteUrl ? new URL(websiteUrl).hostname : '';
      let websiteText = typeof data.websiteText === 'string' ? data.websiteText : '';
      if (websiteText.length > 12_000) throw new Error(`页面文字有 ${websiteText.length} 字符，单轮上限 12000；请分页面提交。`);
      let websiteReadWarning = '';
      if (websiteUrl && !websiteText.trim()) {
        try { websiteText = await deps.readPublicWebsiteText(websiteUrl); }
        catch (error) { websiteReadWarning = error instanceof Error ? error.message : String(error); }
      }
      const research = data.searchExamples === false || deps.publicSearchDisabled()
        ? { results: [], notice: '公开案例搜索未启用。' }
        : await deps.searchExamples(`${hostname ? `${hostname} web application` : 'software requirements'} functional test case examples boundary validation state transition QA`, { limit: 5, timeoutMs: 15_000 }).catch(() => ({ results: [], notice: '公开案例搜索暂时不可用。' }));
      const existingCases = classified.filter(file => file.role === 'held-out-benchmark').flatMap(file => (file.document.testCases ?? []).map(item => ({ title: item.title, source: `[${file.fileName}] ${item.source}`, expected: item.expected })));
      const referenceFiles = classified.filter(file => file.role === 'coverage-reference');
      const uploadedExamples = referenceFiles.flatMap(file => file.document.testCases?.length
        ? file.document.testCases.map(item => ({ title: item.title, url: `uploaded-reference:${file.fileName}`, snippet: `${item.source}\n预期：${item.expected}` }))
        : [{ title: file.fileName, url: `uploaded-reference:${file.fileName}`, snippet: file.document.text.slice(0, 2_500) }]);
      const result = await deps.generateDrafts({ requirementsText, websiteUrl, websiteText, existingCases, examples: [...research.results, ...uploadedExamples], maxCases: data.maxCases });
      const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
      let safeWebsiteReference: string | undefined;
      if (websiteUrl) { const parsed = new URL(websiteUrl); safeWebsiteReference = `${parsed.origin}/[path-redacted]`; }
      result.provenance = {
        status: 'captured',
        requirementsTextSha256: sha256(requirementsText),
        ...(websiteText.trim() ? { websiteTextSha256: sha256(websiteText) } : {}),
        websiteSource: websiteText.trim() ? (typeof data.websiteText === 'string' && data.websiteText.trim() ? 'provided-text' : 'public-read') : 'missing',
        ...(safeWebsiteReference ? { websiteReference: safeWebsiteReference } : {}),
        uploadedFiles: classified.map((file, index) => ({ file, index })).filter(({ file }) => file.role !== 'held-out-benchmark').map(({ file, index }) => {
          const raw = files[index]?.bytesBase64 ?? '';
          return { fileName: file.fileName.slice(0, 255), role: file.role, bytesSha256: sha256(Buffer.from(raw, 'base64')), extractedTextSha256: sha256(file.document.text) };
        }),
        researchSources: research.results.slice(0, 5).map(item => ({ url: (() => { try { return `${new URL(item.url).origin}/[path-redacted]`; } catch { return 'invalid-source'; } })(), snippetSha256: sha256(item.snippet) })),
      };
      if (websiteReadWarning) result.warnings.push(`网页内容未能自动读取：${websiteReadWarning} 可粘贴页面文字后重新生成。`);
      const benchmarkFiles = classified.filter(file => file.role === 'held-out-benchmark');
      if (benchmarkFiles.length) {
        const baselineSource = result.sources.find(source => source.kind === 'existing-cases');
        if (baselineSource) {
          baselineSource.label = `${baselineSource.label}；资料：${benchmarkFiles.map(file => file.fileName).join('、')}`;
          baselineSource.reference = 'generated-after-comparison-only';
        }
      }
      result.sources.push(...classified.filter(file => file.role !== 'held-out-benchmark').map(file => ({ kind: file.role === 'requirements' ? 'requirements' : 'public-examples', label: file.fileName, reference: file.role } as const)));
      json(res, 201, { ...result, generationArtifact: structuredClone(result), research: { count: research.results.length, uploadedReferenceCount: uploadedExamples.length, notice: research.notice }, generationOnly: true });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : '测试用例生成失败。'); }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/case-generator/execute-draft') {
    let data: any;
    try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['generation', 'targetUrl', 'name'].includes(key)) || !Object.hasOwn(data, 'generation') || typeof data.targetUrl !== 'string') {
      fail(res, 400, '移交测试执行需要生成结果和目标网址。'); return true;
    }
    try {
      const project = createExecutionDraftFromCaseGeneration({ targetUrl: data.targetUrl, name: data.name, generation: data.generation });
      project.confirmationRequired = true;
      const workflow = await deps.ensureProjectWorkflow(project);
      json(res, 201, { projectId: project.id, workflowId: workflow.workflowId, projectName: project.name, caseCount: project.cases.length, reviewStatus: project.reviewStatus });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : '无法创建用例执行草稿。'); }
    return true;
  }
  return false;
}
