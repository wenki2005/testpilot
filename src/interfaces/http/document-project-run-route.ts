import type { IncomingMessage, ServerResponse } from "node:http";
import { documentBody, fail, json } from "./http-utils.js";
import type { DocumentProject } from "../../domain/document-test-model.js";
import { DocumentProjectRunPreparationError } from "../../application/runs/document-project-run-preparation-service.js";
import type { DocumentProjectRunUsecaseResult } from "../../application/runs/document-project-run-usecase-service.js";

export interface DocumentProjectRunRouteDependencies {
  getProject(projectId: string): Promise<DocumentProject | undefined>;
  execute(project: DocumentProject, action: string, body: unknown): Promise<DocumentProjectRunUsecaseResult>;
}

/** Parses the project run HTTP request and maps application outcomes to legacy response semantics. */
export async function handleDocumentProjectRunRoute(req: IncomingMessage, res: ServerResponse, pathname: string, deps: DocumentProjectRunRouteDependencies): Promise<boolean> {
  const match = pathname.match(/^\/api\/document-projects\/([^/]+)\/(run|start|resume|retest|checkpoint-retry)$/u);
  if (req.method !== "POST" || !match) return false;

  const project = await deps.getProject(decodeURIComponent(match[1]!));
  if (!project) { fail(res, 404, "文档测试项目不存在。"); return true; }
  let body: unknown;
  try { body = await documentBody(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }

  try {
    const outcome = await deps.execute(project, match[2]!, body);
    if (outcome.kind === "review-required") {
      json(res, 409, { error: outcome.message, repairedCaseIds: outcome.repairedCaseIds, project: outcome.project });
    } else if (outcome.kind === "review-pending" || outcome.kind === "resume-unavailable") {
      fail(res, outcome.kind === "review-pending" ? 409 : outcome.status, outcome.message);
    } else {
      const result = outcome.result;
      if (result.kind === "completed") json(res, result.status, result.run);
      else if (result.kind === "accepted") json(res, result.status, result.body);
      else fail(res, result.status, result.message);
    }
  } catch (error) {
    const status = error instanceof DocumentProjectRunPreparationError ? error.status : 500;
    fail(res, status, error instanceof Error ? error.message : String(error));
  }
  return true;
}
