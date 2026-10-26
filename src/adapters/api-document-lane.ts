import { createHash } from "node:crypto";
import type { ApiTestSuite } from "../storage/api-suite-loader.js";
import type { RunRecord } from "../domain/types.js";

export type ReviewedApiCandidate = {
  id: string;
  status: "draft" | "approved" | "rejected";
  digest: string;
  suite: ApiTestSuite;
};

export type DocumentApiCase = { id: string; title: string; requirementRefs?: string[]; selectedForRegression?: boolean };
export type DocumentApiMapping = { documentCaseId: string; apiCaseIds: string[] };
export type DocumentApiResult = {
  id: string;
  title: string;
  status: "passed" | "failed" | "blocked" | "cancelled" | "not-run";
  detail: string;
  apiCaseResults: Array<{ caseId: string; status: "passed" | "failed" | "blocked" | "error"; detail?: string }>;
};

export type DocumentApiLane = {
  status: "passed" | "failed" | "blocked" | "cancelled";
  summary: string;
  results: DocumentApiResult[];
  provider: string;
  scope?: string[];
  limitations?: string[];
};

/** Run only document cases explicitly routed to API contract, using the existing approved API runner. */
export async function executeDocumentApiLane(input: {
  candidate: ReviewedApiCandidate | undefined;
  documentCases: DocumentApiCase[];
  mapping: DocumentApiMapping[];
  allowNetwork?: boolean;
  allowMutations?: boolean;
  allowConcurrency?: boolean;
  signal?: AbortSignal;
  runApproved: (candidateId: string, options: { allowNetwork: boolean; allowMutations: boolean; allowConcurrency: boolean; selectedCaseIds: string[]; signal?: AbortSignal }) => Promise<{ record: RunRecord }>;
}): Promise<DocumentApiLane> {
  const allRoutedCases = input.documentCases;
  const routedCases = allRoutedCases.filter(item => item.selectedForRegression !== false);
  if (!routedCases.length) return { status: "passed", summary: "没有路由到 API contract 的选中用例。", results: [], provider: "TestPilot approved API runner" };
  if (input.signal?.aborted) return { status: "cancelled", summary: "运行在 API contract 通道开始前被手动停止。", provider: "TestPilot approved API runner", results: routedCases.map(item => ({ id: item.id, title: item.title, status: "not-run", detail: "API contract 用例尚未开始执行。", apiCaseResults: [] })) };
  const candidate = input.candidate;
  let apiResults: DocumentApiResult[];
  let runScope: string[] | undefined;
  let runLimitations: string[] | undefined;
  if (!candidate) {
    apiResults = routedCases.map(item => ({ id: item.id, title: item.title, status: "blocked", detail: "缺少已审核的 API suite；请提供候选 ID 并完成审核。", apiCaseResults: [] }));
  } else {
    try {
      // Validate the approved candidate and mappings before any network request starts.
      if (candidate.status !== "approved") throw new Error("当前 API suite 尚未审核通过。");
      const allowed = new Set(candidate.suite.cases.map(item => item.id));
      const routedIds = new Set(allRoutedCases.map(item => item.id));
      if (routedIds.size !== allRoutedCases.length) throw new Error("API 路由文档用例 ID 必须唯一。");
      const mappedDocumentIds = new Set(input.mapping.map(entry => entry.documentCaseId));
      const unmappedDocumentCases = routedCases.filter(item => !mappedDocumentIds.has(item.id));
      if (unmappedDocumentCases.length) throw new Error(`缺少文档用例到 API case 的显式映射：${unmappedDocumentCases.map(item => item.id).join(", ")}。`);
      if (mappedDocumentIds.size !== input.mapping.length) throw new Error("文档到 API 映射存在重复的 documentCaseId。");
      for (const entry of input.mapping) {
        if (!routedIds.has(entry.documentCaseId)) throw new Error(`映射引用了未路由到 API contract 的文档用例 ${entry.documentCaseId}。`);
        if (!entry.apiCaseIds.length || new Set(entry.apiCaseIds).size !== entry.apiCaseIds.length || entry.apiCaseIds.some(id => !allowed.has(id))) throw new Error(`用例 ${entry.documentCaseId} 的 API 映射必须指向已审核 suite 中存在且不重复的 case ID。`);
      }
      const mappedApiIds = new Set(input.mapping.flatMap(entry => entry.apiCaseIds));
      const unmappedSuiteCases = candidate.suite.cases.filter(item => !mappedApiIds.has(item.id));
      if (unmappedSuiteCases.length) throw new Error(`已审核 API suite 含有未映射用例，避免执行超出文档范围：${unmappedSuiteCases.map(item => item.id).join(", ")}。`);
      const selectedDocumentIds = new Set(routedCases.map(item => item.id));
      const selectedMapping = input.mapping.filter(entry => selectedDocumentIds.has(entry.documentCaseId));
      const selectedApiCaseIds = [...new Set(selectedMapping.flatMap(entry => entry.apiCaseIds))];
      const record = (await input.runApproved(candidate.id, {
        allowNetwork: input.allowNetwork === true,
        allowMutations: input.allowMutations === true,
        allowConcurrency: input.allowConcurrency === true,
        selectedCaseIds: selectedApiCaseIds,
        ...(input.signal ? { signal: input.signal } : {}),
      })).record;
      runScope = record.scope;
      runLimitations = record.limitations;
      apiResults = mapApprovedApiRunToDocumentCases({ candidate, run: record, documentCases: routedCases, mapping: selectedMapping });
      if (input.signal?.aborted) apiResults = apiResults.map(item => {
        if (item.status !== "blocked") return item;
        const activeCancellation = item.apiCaseResults.some(result => result.status === "blocked" && /(?:cancel|abort)/iu.test(result.detail ?? ""));
        return { ...item, status: activeCancellation ? "cancelled" : "not-run", detail: activeCancellation ? "当前 API 请求在运行被手动停止时中断；结果未判定。" : "运行被手动停止；此 API 用例尚未执行。" };
      });
      const fixtureLifecycleFailures = record.results.filter(item => /^\[fixture (?:setup|cleanup)\]/u.test(item.title) && item.status !== "passed");
      if (fixtureLifecycleFailures.length) {
        const details = fixtureLifecycleFailures.map(item => `${item.title}: ${item.status}`).join("; ");
        apiResults = apiResults.map(item => item.status === "passed"
          ? { ...item, status: "blocked", detail: `${item.detail} Fixture setup/cleanup未全部通过（${details}），此结果不能视为通过。` }
          : item);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      apiResults = routedCases.map(item => ({ id: item.id, title: item.title, status: "blocked", detail: `API contract lane 未执行：${detail}`, apiCaseResults: [] }));
    }
  }
  const counts = { passed: apiResults.filter(item => item.status === "passed").length, failed: apiResults.filter(item => item.status === "failed").length, blocked: apiResults.filter(item => item.status === "blocked").length, cancelled: apiResults.filter(item => item.status === "cancelled").length, notRun: apiResults.filter(item => item.status === "not-run").length };
  const status = input.signal?.aborted ? "cancelled" : counts.failed ? "failed" : counts.blocked ? "blocked" : "passed";
  return { status, summary: input.signal?.aborted ? `API contract 运行已停止：${counts.cancelled} 条取消、${counts.notRun} 条未运行，${counts.passed} 条此前完成通过、${counts.failed} 条此前完成失败。` : `API contract：${counts.passed} 通过、${counts.failed} 失败、${counts.blocked} 阻塞。`, results: apiResults, provider: "TestPilot approved API runner", ...(runScope ? { scope: runScope } : {}), ...(runLimitations ? { limitations: runLimitations } : {}) };
}

/**
 * Project an already completed API run onto explicitly mapped document cases.
 * This function is pure: it does not approve candidates, execute requests, or infer routes.
 */
export function mapApprovedApiRunToDocumentCases(input: {
  candidate: ReviewedApiCandidate;
  run: RunRecord;
  documentCases: DocumentApiCase[];
  mapping: DocumentApiMapping[];
}): DocumentApiResult[] {
  const { candidate, run, documentCases, mapping } = input;
  if (candidate.status !== "approved") throw new Error("API document mapping requires an approved API suite candidate.");
  if (!candidate.id || !/^[a-f0-9]{64}$/i.test(candidate.digest)) throw new Error("API suite candidate identity or digest is invalid.");
  const actualDigest = createHash("sha256").update(JSON.stringify(candidate.suite)).digest("hex");
  if (actualDigest !== candidate.digest) throw new Error("API suite candidate digest does not match its content.");
  const approvedScope = `Approved API suite: ${candidate.id} (SHA-256 ${candidate.digest})`;
  if (!run.scope.includes(approvedScope)) throw new Error("API run evidence does not belong to this approved suite version.");

  const suiteCaseIds = new Set(candidate.suite.cases.map(item => item.id));
  const documentIds = new Set(documentCases.map(item => item.id));
  const mappingByDocumentId = new Map<string, string[]>();
  for (const entry of mapping) {
    if (!documentIds.has(entry.documentCaseId)) throw new Error(`Mapping references unknown document case: ${entry.documentCaseId}.`);
    if (mappingByDocumentId.has(entry.documentCaseId)) throw new Error(`Duplicate API mapping for document case: ${entry.documentCaseId}.`);
    if (!entry.apiCaseIds.length || new Set(entry.apiCaseIds).size !== entry.apiCaseIds.length || entry.apiCaseIds.some(id => !suiteCaseIds.has(id))) {
      throw new Error(`Mapping for ${entry.documentCaseId} must reference one or more unique cases in the approved API suite.`);
    }
    mappingByDocumentId.set(entry.documentCaseId, entry.apiCaseIds);
  }

  return documentCases.filter(item => item.selectedForRegression !== false).map(item => {
    const apiCaseIds = mappingByDocumentId.get(item.id);
    if (!apiCaseIds) return { id: item.id, title: item.title, status: "blocked", detail: "No explicit approved API case mapping is configured for this document case.", apiCaseResults: [] };
    const apiCaseResults = apiCaseIds.map(caseId => {
      const result = run.results.find(candidateResult => candidateResult.caseId === caseId);
      return { caseId, status: result?.status ?? "blocked" as const, ...(result && "error" in result && typeof result.error === "string" ? { detail: result.error } : {}) };
    });
    const status: DocumentApiResult["status"] = apiCaseResults.some(result => result.status === "failed" || result.status === "error")
      ? "failed"
      : apiCaseResults.some(result => result.status === "blocked") ? "blocked" : "passed";
    const details = apiCaseResults.map(result => `${result.caseId}: ${result.status}`).join(", ");
    return { id: item.id, title: item.title, status, detail: `Approved API suite ${candidate.id}; ${details}.`, apiCaseResults };
  });
}
