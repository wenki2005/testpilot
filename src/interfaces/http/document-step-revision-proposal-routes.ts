import type { IncomingMessage, ServerResponse } from "node:http";
import type { DocumentProject, DocumentRun } from "../../domain/document-test-model.js";
import type { StepRevisionProposal } from "../../application/runs/document-step-revision-proposal-service.js";
import { bodyJson, fail, json } from "./http-utils.js";

export interface DocumentStepRevisionProposalRouteService {
  create(runId: string, caseId: string): Promise<StepRevisionProposal>;
  list(runId: string): Promise<StepRevisionProposal[]>;
  get(id: string): Promise<StepRevisionProposal | undefined>;
  review(id: string, decision: "accept" | "reject"): Promise<{ proposal: StepRevisionProposal; project?: DocumentProject }>;
}

export async function handleDocumentStepRevisionProposalRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  service: DocumentStepRevisionProposalRouteService,
  getRun: (id: string) => Promise<DocumentRun | undefined>,
): Promise<boolean> {
  const route = url.pathname.match(/^\/api\/document-runs\/([^/]+)\/step-revision-proposals(?:\/([^/]+)\/review)?$/u);
  if (!route) return false;
  const runId = decodeURIComponent(route[1]!);
  const proposalId = route[2] ? decodeURIComponent(route[2]) : undefined;
  if (runId.length > 160 || proposalId && !/^[0-9a-f-]{36}$/iu.test(proposalId)) { fail(res, 400, "运行或提案 ID 无效。"); return true; }
  try {
    const run = await getRun(runId);
    if (!run || run.id !== runId) { fail(res, 404, "运行记录不存在。"); return true; }
    if (!proposalId && req.method === "GET") {
      json(res, 200, await service.list(runId));
      return true;
    }
    if (!proposalId && req.method === "POST") {
      let body: unknown;
      try { body = await bodyJson(req); }
      catch (error) { fail(res, 400, error instanceof Error ? error.message : "请求体无效。"); return true; }
      const caseId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).caseId : undefined;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
        || typeof caseId !== "string" || !caseId.trim() || caseId.length > 80) {
        fail(res, 400, "请求体只能包含有效 caseId。"); return true;
      }
      json(res, 201, await service.create(runId, caseId));
      return true;
    }
    if (proposalId && req.method === "POST") {
      const proposal = await service.get(proposalId);
      if (!proposal || proposal.runId !== runId || proposal.projectId !== run.projectId) { fail(res, 404, "该运行下找不到步骤修订提案。"); return true; }
      let body: unknown;
      try { body = await bodyJson(req); }
      catch (error) { fail(res, 400, error instanceof Error ? error.message : "请求体无效。"); return true; }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
        || !["accept", "reject"].includes(String((body as Record<string, unknown>).decision))) {
        fail(res, 400, "请求体只能包含 accept 或 reject 决策。"); return true;
      }
      json(res, 200, await service.review(proposalId, (body as { decision: "accept" | "reject" }).decision));
      return true;
    }
    fail(res, 405, "此路径不支持该 HTTP 方法。");
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error && Number.isInteger((error as { status: unknown }).status)
      ? Number((error as { status: number }).status) : 422;
    fail(res, status, error instanceof Error ? error.message : "步骤修订提案操作失败。");
  }
  return true;
}
