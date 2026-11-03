import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserCheck, DocumentProject } from "../../domain/document-test-model.js";
import type { BrowserStep } from "../../domain/document-test-model.js";
import { documentBody, fail, json } from "./http-utils.js";
import type { DocumentAuthoringContext } from '../../domain/document-authoring-context.js';
import { missingDirectAssertion } from '../../domain/document-case-assertion-quality.js';

export interface DocumentCaseStepRouteDependencies {
  getProject(id: string): Promise<DocumentProject | undefined>;
  saveProject(project: DocumentProject): Promise<void>;
  modelAvailable(): boolean;
  collectPageEvidence(project: DocumentProject): Promise<string>;
  collectAuthoringContext?(project: DocumentProject, item: BrowserCheck): Promise<DocumentAuthoringContext>;
  generateSteps(targetUrl: string, item: BrowserCheck & { caseGenerationActions: string[] }, pageEvidence: string, feedback?: string, context?: DocumentAuthoringContext): Promise<BrowserStep[]>;
  draftEvidenceBoundUiCheck(item: BrowserCheck, pageEvidence: string): BrowserStep[] | undefined;
  validateCases(cases: Array<BrowserCheck & { steps: BrowserStep[] }>): Array<BrowserCheck & { steps: BrowserStep[] }>;
}

/** Handles generation of one case's evidence-bound, reviewable browser-step draft. */
export async function handleDocumentCaseStepRoute(req: IncomingMessage, res: ServerResponse, pathname: string, deps: DocumentCaseStepRouteDependencies): Promise<boolean> {
  if (req.method !== "POST") return false;
  const match = pathname.match(/^\/api\/document-projects\/([^/]+)\/cases\/([^/]+)\/generate-steps$/);
  if (!match) return false;
  const projectId = decodeURIComponent(match[1]!);
  const caseId = decodeURIComponent(match[2]!);
  const project = await deps.getProject(projectId);
  if (!project) { fail(res, 404, "文档测试项目不存在。"); return true; }
  try { await documentBody(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }
  if (!deps.modelAvailable()) { fail(res, 409, "AI 步骤草稿需要先配置 TESTPILOT_API_KEY 或 OPENAI_API_KEY。现有手动编辑和审核流程仍可使用。"); return true; }
  const caseIndex = project.cases.findIndex(item => item.id === caseId);
  if (caseIndex < 0) { fail(res, 404, "目标文档用例不存在。"); return true; }
  const item = project.cases[caseIndex]!;
  try {
    const pageEvidence = await deps.collectPageEvidence(project);
    let steps: BrowserStep[];
    const authoringItem = { ...item, caseGenerationActions: item.caseGenerationTrace?.actions ?? [] };
    const context = await deps.collectAuthoringContext?.(project, item);
    try { steps = await deps.generateSteps(project.targetUrl, authoringItem, pageEvidence, undefined, context); }
    catch (error) {
      steps = deps.draftEvidenceBoundUiCheck(item, pageEvidence) ?? [];
      if (!steps.length) throw new Error(`AI 没有生成可执行步骤；${error instanceof Error ? error.message : String(error)}`);
    }
    if (!steps.length || !steps.some(step => ["assertText", "assertVisible", "assertNotVisible", "assertExactVisible", "assertRoleVisible", "assertRoleDisabled", "assertMaxLengthOrMessage", "assertValue", "assertDisabled", "assertFieldInvalid", "assertNoFetchOrXhr", "assertNoHorizontalOverflow"].includes(step.action))) {
      throw new Error("没有生成可执行的验收断言；保留原用例并补充页面证据、具体测试数据或可观察的通过条件后重试。空草稿不会保存为已生成步骤。");
    }
    // Revalidate at the HTTP boundary and update only steps, preserving case IDs and provenance.
    const validated = deps.validateCases([{ ...item, steps }])[0]!;
    const gap = missingDirectAssertion(validated);
    if (gap && !validated.coverageGap) throw new Error(gap);
    project.cases[caseIndex] = { ...item, steps: validated.steps };
    project.reviewStatus = "draft";
    project.reviewNotes = "";
    project.updatedAt = new Date().toISOString();
    await deps.saveProject(project);
    json(res, 200, { project, steps: validated.steps });
  } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
  return true;
}
