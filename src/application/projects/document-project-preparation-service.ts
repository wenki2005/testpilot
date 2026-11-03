import { randomUUID, createHash } from 'node:crypto';
import type { ImportedDocument } from '../../domain/document-test-contracts.js';
import { documentProjectPlatformTemplates, type BrowserCheck, type DocumentProject, type DocumentProjectExecutionConfig, type DocumentProjectPlatform, type StepGenerationCaseResult } from '../../domain/document-test-model.js';

export type DocumentPreparationStage = 'planning' | 'reading-materials' | 'web-research' | 'generating-cases' | 'reviewing-cases' | 'generating-steps' | 'ready' | 'needs-review' | 'failed';
export type DocumentPreparationTask = {
  id: string;
  status: 'running' | 'completed' | 'needs-review' | 'failed';
  stage: DocumentPreparationStage;
  events: Array<{ stage: DocumentPreparationStage; status: 'running' | 'completed' | 'warning' | 'failed'; message: string; at: string }>;
  projectId?: string;
  workflowId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type InputRole = 'auto' | 'requirements' | 'coverage-reference' | 'held-out-benchmark';
export type DocumentProjectPreparationInput = {
  targetUrl: string;
  files: Array<{ fileName: string; bytesBase64: string; role?: InputRole }>;
  name?: unknown;
  contextText?: string;
  caseMode?: 'existing' | 'ai' | 'both';
  requireConfirmation?: boolean;
  platform?: Exclude<DocumentProjectPlatform, 'unknown'>;
};
type Research = { results: Array<{ title: string; url: string; snippet: string }>; provider: string; notice: string };
type ResolvedSources = {
  requirementsText: string;
  sourceRoles: Array<{ fileName: string; role: 'requirements' | 'coverage-reference' | 'held-out-benchmark' }>;
  coverageReferences: Array<{ title: string; url: string; snippet: string }>;
  benchmarkCases: Array<{ title: string; source: string; expected: string }>;
};
type StageReply = { stage: { status: string; attempt: number } };

export interface DocumentProjectPreparationDependencies {
  tasks: Map<string, DocumentPreparationTask>;
  recordTask(task: DocumentPreparationTask, stage: DocumentPreparationStage, state: 'running' | 'completed' | 'warning' | 'failed', message: string): Promise<void>;
  extractDocument(fileName: string, bytes: Buffer): Promise<ImportedDocument>;
  createReviewCases(text: string): BrowserCheck[];
  searchExamples(query: string, options: { limit: number; timeoutMs: number }): Promise<Research>;
  readPublicWebsiteText(url: string): Promise<string>;
  resolveInputRoles(sources: Array<{ fileName: string; requestedRole: InputRole; document: ImportedDocument }>): ResolvedSources;
  makeProject(input: { name: unknown; fileName: string; sourceFiles: string[]; researchExamples: Research['results']; caseMode: 'existing' | 'ai' | 'both'; document: ImportedDocument; targetUrl: string }): DocumentProject;
  createWorkflow(input: { projectId: string; approvalPolicy: 'confirm-before-execution' | 'automatic' }): Promise<{ workflowId: string }>;
  startWorkflowStage(workflowId: string, input: { stageId: 'generate-cases' | 'review-cases' | 'author-steps' | 'human-approval'; specialist: 'case-generator' | 'case-reviewer' | 'step-author' | 'human-review-gate'; input: any }): Promise<StageReply>;
  completeWorkflowStage(workflowId: string, stageId: string, attempt: number, artifacts: string[]): Promise<unknown>;
  waitWorkflowStage(workflowId: string, stageId: string, attempt: number, reason: string): Promise<unknown>;
  failWorkflowStage(workflowId: string, stageId: string, attempt: number, error: { message: string; code: string }): Promise<unknown>;
  getWorkflow(workflowId: string): Promise<{ stages: Array<{ stageId: string; status: string; attempt: number }> } | undefined>;
  saveProject(project: DocumentProject): Promise<void>;
  writeSource(project: DocumentProject, bytes: Buffer, fileName: string, index: number): Promise<void>;
  generateBrowserCases(sourceText: string, examples: Research['results']): Promise<unknown[]>;
  modelAvailable(): boolean;
  validateCases(value: unknown): BrowserCheck[];
  validateCasesPreservingTrace(value: unknown, existing: BrowserCheck[]): BrowserCheck[];
  mergeBrowserCases(existing: BrowserCheck[], generated: BrowserCheck[]): BrowserCheck[];
  generateMissingSteps(project: DocumentProject): Promise<{ caseResults: StepGenerationCaseResult[]; warning?: string }>;
  requiresManualReview(project: DocumentProject): boolean;
  hasAutoRunnableSelectedCase(cases: BrowserCheck[]): boolean;
  newId(): string;
  now(): string;
}

export function createDocumentProjectPreparationService(deps: DocumentProjectPreparationDependencies) {
  async function recordFailure(task: DocumentPreparationTask, error: unknown): Promise<void> {
    task.status = 'failed';
    task.error = error instanceof Error ? error.message : String(error);
    if (task.workflowId) {
      const state = await deps.getWorkflow(task.workflowId).catch(() => undefined);
      const active = [...(state?.stages ?? [])].reverse().find(stage => stage.status === 'running');
      if (active) await deps.failWorkflowStage(task.workflowId, active.stageId, active.attempt, { message: task.error, code: 'preparation-stage-failed' }).catch(() => undefined);
    }
    await deps.recordTask(task, 'failed', 'failed', task.error).catch(() => undefined);
  }

  async function run(task: DocumentPreparationTask, input: DocumentProjectPreparationInput): Promise<void> {
    try {
      const files = input.files;
      await deps.recordTask(task, 'reading-materials', 'running', '正在解析需求资料与已有测试用例。');
      const imported = await Promise.all(files.map(async file => {
        const bytes = Buffer.from(file.bytesBase64, 'base64');
        if (!bytes.length || bytes.length > 9 * 1024 * 1024) throw new Error(`${file.fileName} 不能为空且不能超过 9 MB。`);
        let document = await deps.extractDocument(file.fileName, bytes);
        if (file.role === 'held-out-benchmark' && !document.testCases?.length) {
          const extracted = deps.createReviewCases(document.text);
          document = { ...document, testCases: extracted.map(item => ({ title: item.title, source: item.source, expected: item.expected, priority: item.priority, category: item.category, confidence: item.confidence, coverageAreas: item.coverageAreas, requirementRefs: item.requirementRefs })) };
        }
        return { file, bytes, document };
      }));
      await deps.recordTask(task, 'reading-materials', 'completed', `已解析 ${imported.length} 份资料，共提取 ${imported.reduce((sum, item) => sum + (item.document.testCases?.length ?? 0), 0)} 条已有测试用例。`);
      await deps.recordTask(task, 'web-research', 'running', '正在查找公开测试案例参考；参考内容只用于覆盖启发，不视为目标应用事实。');
      const research = await deps.searchExamples(`${new URL(input.targetUrl).hostname} web application QA test case examples`, { limit: 5, timeoutMs: 15_000 });
      await deps.recordTask(task, 'web-research', research.results.length ? 'completed' : 'warning', research.results.length ? `找到 ${research.results.length} 条公开参考。` : `没有可用公开参考：${research.notice}`);
      const fileName = imported.map(({ file }) => file.fileName).join('、').slice(0, 200);
      const resolved = deps.resolveInputRoles(imported.map(({ file, document }) => ({ fileName: file.fileName, requestedRole: file.role ?? 'auto', document })));
      let sourceText = resolved.requirementsText;
      const caseMode = input.caseMode === 'existing' || input.caseMode === 'ai' || input.caseMode === 'both' ? input.caseMode : 'both';
      let websiteReadWarning = '';
      let websiteContent = '';
      try { websiteContent = await deps.readPublicWebsiteText(input.targetUrl); }
      catch (error) { websiteReadWarning = error instanceof Error ? error.message : String(error); }
      if (websiteContent) sourceText = [sourceText, `# 网站可公开读取的页面文字\n\n${websiteContent}`].filter(Boolean).join('\n\n---\n\n');
      if (!sourceText.trim() && caseMode !== 'existing') sourceText = `# 网站探索目标\n\n目标网址：${input.targetUrl}\n\n请根据目标页面中实际可观察到的内容设计测试用例；业务规则或登录后状态无法确认时，明确标注待澄清，不得猜测预期。`;
      if (sourceText.length > 100_000) throw new Error(`需求与网站资料合计 ${sourceText.length} 字符，项目上限 100000；请拆分文档，不会静默截断。`);
      const benchmarkCases = resolved.benchmarkCases;
      if (benchmarkCases.length > 200) throw new Error(`资料中提取到 ${benchmarkCases.length} 条用例，单项目上限 200；请拆分为多个项目，未静默漏掉尾部用例。`);
      if (research.results.length + resolved.coverageReferences.length > 8) throw new Error(`公开搜索参考 ${research.results.length} 条，加上上传覆盖参考 ${resolved.coverageReferences.length} 条后超过模型输入上限 8；请将部分资料标为留出基准，或减少覆盖参考文件。`);
      const primary = imported[0]!.document;
      const document: ImportedDocument = { format: primary.format, text: sourceText, ...(benchmarkCases.length ? { testCases: benchmarkCases } : {}) };
      const project = deps.makeProject({ name: input.name, fileName, sourceFiles: imported.map(({ file }) => file.fileName), researchExamples: [...research.results, ...resolved.coverageReferences], caseMode, document, targetUrl: input.targetUrl });
      if (input.platform && Object.hasOwn(documentProjectPlatformTemplates, input.platform)) {
        project.platform = { type: input.platform, status: 'confirmed', confirmedAt: deps.now() };
        project.executionConfig = { ...structuredClone(documentProjectPlatformTemplates[input.platform]), entryUrl: input.targetUrl } satisfies DocumentProjectExecutionConfig;
      } else {
        project.platform = { type: 'unknown', status: 'needs-confirmation' };
      }
      project.sourceRoles = [...resolved.sourceRoles, ...(websiteContent ? [{ fileName: new URL(input.targetUrl).hostname, role: 'website-content' as const }] : [])];
      const materialCreatedAt = deps.now();
      const materials = imported.map(({ file, bytes }, index) => ({
        id: deps.newId(), fileName: file.fileName, role: resolved.sourceRoles[index]?.role ?? ('requirements' as const),
        sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, createdAt: materialCreatedAt,
      }));
      const websiteMaterial = websiteContent ? { id: deps.newId(), fileName: new URL(input.targetUrl).hostname, role: 'website-content' as const, sha256: createHash('sha256').update(websiteContent, 'utf8').digest('hex'), byteLength: Buffer.byteLength(websiteContent, 'utf8'), createdAt: materialCreatedAt } : undefined;
      project.sourceMaterials = [...materials, ...(websiteMaterial ? [websiteMaterial] : [])];
      project.materialTexts = Object.fromEntries([
        ...imported.map(({ document: source }, index) => [materials[index]!.id, source.text] as const),
        ...(websiteMaterial ? [[websiteMaterial.id, websiteContent] as const] : []),
      ]);
      project.contextText = typeof input.contextText === 'string' ? input.contextText.trim() : '';
      task.projectId = project.id;
      const workflow = await deps.createWorkflow({ projectId: project.id, approvalPolicy: input.requireConfirmation === true ? 'confirm-before-execution' : 'automatic' });
      project.workflowId = workflow.workflowId;
      task.workflowId = workflow.workflowId;
      project.confirmationRequired = input.requireConfirmation === true;
      project.workflowPlan = [...(project.workflowPlan ?? []), `联网调研结果：${research.results.length} 条参考${research.provider === 'none' ? `（${research.notice}）` : `（${research.provider}）`}`];
      if (project.contextText) project.sourceText += `\n\n## 用户补充的测试重点\n${project.contextText}`;
      if (websiteReadWarning) project.workflowPlan.push(`网站正文未能读取：${websiteReadWarning}；模型只使用明确的需求资料、用户说明和公开参考。`);
      await deps.saveProject(project);
      await deps.recordTask(task, 'planning', 'completed', `已创建可追踪 workflow ${workflow.workflowId}，生成模型只接收需求资料与公开参考；留出基准在生成后比较。`);
      let generationWarning = '';
      await deps.recordTask(task, 'generating-cases', 'running', '正在根据资料、已有用例和公开参考生成或整理测试用例。');
      const generationStage = await deps.startWorkflowStage(workflow.workflowId, { stageId: 'generate-cases', specialist: 'case-generator', input: { caseMode, requirementsDigest: createHash('sha256').update(project.sourceText).digest('hex'), publicReferenceIds: research.results.map(item => item.url), heldOutBenchmarkCount: benchmarkCases.length, heldOutBenchmarkDigest: createHash('sha256').update(JSON.stringify(benchmarkCases)).digest('hex') } });
      if (caseMode !== 'existing' && deps.modelAvailable()) {
        try {
          const existing = [...project.cases];
          const generated = deps.validateCases(await deps.generateBrowserCases(project.sourceText, [...research.results, ...resolved.coverageReferences])).map(item => ({ ...item, caseOrigin: 'ai-generated' as const, lifecycleStatus: 'draft' as const, selectedForRegression: false }));
          project.cases = deps.validateCasesPreservingTrace(caseMode === 'both' ? deps.mergeBrowserCases(existing, generated) : generated, existing);
        } catch (error) { generationWarning = error instanceof Error ? error.message : String(error); }
      } else if (caseMode !== 'existing' && !deps.modelAvailable()) generationWarning = '未配置兼容模型 API：已保留资料中现有用例；AI 补充和 Computer Use 暂不可用。可在设置中配置模型后重新生成。';
      if (generationWarning) project.generationWarning = generationWarning; else delete project.generationWarning;
      await deps.saveProject(project);
      if (!project.cases.length) throw new Error(generationWarning || '资料未产生测试用例；请补充可判定的需求或已有用例。未进入审核与执行阶段。');
      if (generationStage.stage.status === 'running') await deps.completeWorkflowStage(workflow.workflowId, 'generate-cases', generationStage.stage.attempt, [`project:${project.id}:cases:${createHash('sha256').update(JSON.stringify(project.cases)).digest('hex')}`]);
      await deps.recordTask(task, 'generating-cases', generationWarning ? 'warning' : 'completed', generationWarning ? `用例生成遇到限制：${generationWarning}` : `已整理 ${project.cases.length} 条测试用例。`);
      await deps.recordTask(task, 'reviewing-cases', 'running', '正在校验用例结构、唯一 ID、预期结果、需求引用及执行范围。');
      const reviewStage = await deps.startWorkflowStage(workflow.workflowId, { stageId: 'review-cases', specialist: 'case-reviewer', input: { casesDigest: createHash('sha256').update(JSON.stringify(project.cases)).digest('hex'), requirementsDigest: createHash('sha256').update(project.sourceText).digest('hex') } });
      project.cases = deps.validateCasesPreservingTrace(project.cases, project.cases);
      if (reviewStage.stage.status === 'running') await deps.completeWorkflowStage(workflow.workflowId, 'review-cases', reviewStage.stage.attempt, [`project:${project.id}:validated-cases:${createHash('sha256').update(JSON.stringify(project.cases)).digest('hex')}`]);
      await deps.saveProject(project);
      await deps.recordTask(task, 'reviewing-cases', 'completed', `结构与引用校验通过；用例总数 ${project.cases.length}，AI 生成与基准来源分别保留。`);
      await deps.recordTask(task, 'generating-steps', 'running', '正在为用例生成受限浏览器步骤并检查是否可自动执行。');
      const stepStage = await deps.startWorkflowStage(workflow.workflowId, { stageId: 'author-steps', specialist: 'step-author', input: { caseIds: project.cases.map(item => item.id), casesDigest: createHash('sha256').update(JSON.stringify(project.cases)).digest('hex'), targetUrl: project.targetUrl } });
      if (project.cases.length) {
        const stepResult = await deps.generateMissingSteps(project);
        project.stepAuthoring = { generatedAt: deps.now(), results: stepResult.caseResults };
        if (stepResult.warning) generationWarning = [generationWarning, stepResult.warning].filter(Boolean).join(' ');
      } else generationWarning = [generationWarning, '没有提取到可执行测试用例。'].filter(Boolean).join(' ');
      if (stepStage.stage.status === 'running') await deps.completeWorkflowStage(workflow.workflowId, 'author-steps', stepStage.stage.attempt, [`project:${project.id}:steps:${createHash('sha256').update(JSON.stringify(project.cases.map(item => ({ id: item.id, steps: item.steps })))).digest('hex')}`]);
      if (generationWarning) project.generationWarning = generationWarning; else delete project.generationWarning;
      if (!project.confirmationRequired && !deps.requiresManualReview(project) && deps.hasAutoRunnableSelectedCase(project.cases)) {
        project.cases = deps.validateCases(project.cases);
        project.reviewStatus = 'approved';
        project.reviewNotes = '用户选择自动运行：已就绪的只读用例通过服务端安全 DSL 校验后自动执行；缺步骤、风险未定或依赖缺失的用例会逐条标为阻塞并说明补齐项。';
      }
      await Promise.all(imported.map(({ file, bytes }, index) => deps.writeSource(project, bytes, file.fileName, index + 1)));
      await deps.saveProject(project);
      const approvalInput = { projectId: project.id, reviewedCaseDigest: createHash('sha256').update(JSON.stringify(project.cases)).digest('hex'), confirmationRequired: project.confirmationRequired === true, securityGatePassed: project.reviewStatus === 'approved' };
      const approvalGate = await deps.startWorkflowStage(workflow.workflowId, { stageId: 'human-approval', specialist: 'human-review-gate', input: approvalInput });
      if (project.reviewStatus === 'approved' && approvalGate.stage.status === 'running') await deps.completeWorkflowStage(workflow.workflowId, 'human-approval', approvalGate.stage.attempt, [`project:${project.id}:approved:${createHash('sha256').update(project.reviewNotes ?? '').digest('hex')}`]);
      else if (approvalGate.stage.status === 'running') await deps.waitWorkflowStage(workflow.workflowId, 'human-approval', approvalGate.stage.attempt, '自动模式安全门未通过或用例仍有待澄清项；等待用户在同一项目对话中复核范围、风险或补充条件。');
      task.status = project.reviewStatus === 'approved' ? 'completed' : 'needs-review';
      await deps.recordTask(task, task.status === 'completed' ? 'ready' : 'needs-review', task.status === 'completed' ? 'completed' : 'warning', task.status === 'completed' ? '准备完成；用例通过安全门禁，按设置自动继续测试。' : generationWarning || '用例已准备完成，等待审核或补充可执行信息后继续。');
    } catch (error) { await recordFailure(task, error); }
  }

  async function start(input: DocumentProjectPreparationInput): Promise<DocumentPreparationTask> {
    const now = deps.now();
    const task: DocumentPreparationTask = { id: deps.newId(), status: 'running', stage: 'planning', events: [], createdAt: now, updatedAt: now };
    deps.tasks.set(task.id, task);
    await deps.recordTask(task, 'planning', 'completed', `目标已锁定：${input.targetUrl}；输入 ${input.files.length} 份资料；将解析资料、查询公开参考、准备可执行用例，并遵守${input.requireConfirmation === true ? '需要用户审核' : '自动安全审核'}策略。`);
    void run(task, input);
    return task;
  }

  return { start };
}
