import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserCheck } from "../../domain/document-test-model.js";
import { exportCasesMarkdown } from "../../domain/document-case-markdown.js";
import { documentBody, fail, json } from "./http-utils.js";

export interface DocumentCaseMarkdownRouteDependencies {
  getCases(projectId: string): Promise<BrowserCheck[] | undefined>;
  preview(projectId: string, markdown: string): Promise<unknown>;
  import(projectId: string, markdown: string, expectedDigest: string): Promise<unknown>;
}

export async function handleDocumentCaseMarkdownRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: DocumentCaseMarkdownRouteDependencies,
): Promise<boolean> {
  const route = pathname.match(/^\/api\/document-projects\/([^/]+)\/cases\.md(?:\/(preview|import))?$/u);
  if (!route) return false;

  let projectId: string;
  try { projectId = decodeURIComponent(route[1]!); }
  catch { fail(res, 400, "项目 ID 编码无效。"); return true; }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId)) { fail(res, 400, "项目 ID 无效。"); return true; }

  const action = route[2];
  try {
    if (req.method === "GET" && !action) {
      const cases = await deps.getCases(projectId);
      if (!cases) { fail(res, 404, "项目不存在。"); return true; }
      const markdown = exportCasesMarkdown(projectId, cases);
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${projectId}-cases.md"`,
        "cache-control": "no-store",
      });
      res.end(markdown);
      return true;
    }
    if (req.method !== "POST" || !action) return false;

    const body = await documentBody(req);
    if (typeof body?.markdown !== "string") { fail(res, 400, "需要 markdown 字符串。"); return true; }
    if (action === "preview") json(res, 200, await deps.preview(projectId, body.markdown));
    else json(res, 200, await deps.import(projectId, body.markdown, body.expectedDigest));
  } catch (cause) {
    const error = cause as Error & { code?: string };
    const status = error.code === "not-found" ? 404 : error.code === "stale" ? 409 : error.code === "invalid" ? 400 : 422;
    fail(res, status, error.message || "用例 Markdown 请求失败。");
  }
  return true;
}
