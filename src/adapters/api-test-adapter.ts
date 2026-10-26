import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { ApiDesignAssessmentCheck, CaseResult, EvidenceItem, RunRecord, RunStatus } from "../domain/types.js";
import type { ApiOpenApiScenarioCoverage, ApiTestCase, ApiTestSuite } from "../storage/api-suite-loader.js";
import { caseMatchesOperationRoute } from "../storage/openapi-boundary.js";

const maxBodyBytes = 1_000_000;
const maxRunEvidenceBytes = 5_000_000;
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function runApiSuite(options: { suite: ApiTestSuite; baseUrl?: string; allowNetwork?: boolean; allowMutations?: boolean; allowConcurrency?: boolean; caseIds?: string[]; rerunOf?: string; scopeOnly?: boolean; outputRoot: string; signal?: AbortSignal; approvedSuite?: { id: string; digest: string } }): Promise<{ record: RunRecord; recordPath: string; packagePath: string }> {
  const rawBase = options.baseUrl ?? options.suite.baseUrl;
  if (!rawBase) throw new Error("Provide --base-url or set baseUrl in the API suite.");
  const baseUrl = validateTargetBase(rawBase, options.allowNetwork === true);
  const selectedCases = selectApiCases(options.suite, options.caseIds);
  if (options.scopeOnly === true) {
    if (!options.caseIds?.length || options.rerunOf) throw new Error("A document-scoped API run requires selected case IDs and cannot include a rerun parent.");
  } else if (Boolean(options.rerunOf) !== Boolean(options.caseIds)) throw new Error("A targeted rerun must specify both the parent run ID and approved case IDs to execute.");
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const results: CaseResult[] = [];
  try {
    let setupSucceeded = true;
    for (const fixtureCase of options.suite.fixtures?.setup ?? []) {
      if (options.signal?.aborted) { setupSucceeded = false; break; }
      const value = await executeApiCase(fixtureCase, baseUrl, options.allowMutations === true, runId, options.signal);
      results.push({ ...value, title: `[fixture setup] ${value.title}` });
      if (value.status !== "passed") { setupSucceeded = false; break; }
    }
    for (const item of selectedCases) {
      if (options.signal?.aborted) break;
      if (!setupSucceeded) {
        results.push(result(item, "blocked", Date.now(), item.expect.status, null, "Fixture setup did not pass; test request was not sent.", [{ kind: "note", content: "Case skipped because isolated test data was not prepared.", capturedAt: new Date().toISOString() }]));
        continue;
      }
      results.push(await executeConfiguredCase(item, options.suite, baseUrl, options.allowMutations === true, options.allowConcurrency === true, runId, options.signal));
      if (options.signal?.aborted) break;
    }
  } catch (error) {
    if (!options.signal?.aborted) results.push({ caseId: "__runner__", title: "API runner internal error", status: "error", durationMs: 0, assertion: { expected: "Suite completes and cleanup is attempted", actual: "Runner error" }, error: error instanceof Error ? error.message : String(error), evidence: [{ kind: "stderr", content: error instanceof Error ? error.message : String(error), capturedAt: new Date().toISOString() }] });
  } finally {
    for (const fixtureCase of [...(options.suite.fixtures?.cleanup ?? [])].reverse()) {
      try {
        // Cleanup is deliberately not cancelled with the test signal; after an aborted test, make a bounded best effort to remove fixture data.
        const value = await executeApiCase(fixtureCase, baseUrl, options.allowMutations === true, runId);
        results.push({ ...value, title: `[fixture cleanup] ${value.title}` });
      } catch (error) {
        results.push({ caseId: `fixture-cleanup-${fixtureCase.id}`, title: `[fixture cleanup] ${fixtureCase.title}`, status: "error", durationMs: 0, assertion: { expected: "Cleanup completes", actual: "Runner error" }, error: error instanceof Error ? error.message : String(error), evidence: [{ kind: "stderr", content: error instanceof Error ? error.message : String(error), capturedAt: new Date().toISOString() }] });
      }
    }
  }
  const evidenceWasCapped = capRunEvidence(results);
  const status: RunStatus = results.length === 0 ? "blocked"
    : results.some(item => item.status === "error") ? "error"
      : results.some(item => item.status === "failed") ? "failed"
        : results.some(item => item.status === "blocked") ? "blocked" : "passed";
  const completedAt = new Date().toISOString();
  const apiDesignAssessment = buildApiDesignAssessment(options.suite, results);
  const record: RunRecord = {
    schemaVersion: 1, runId, mode: "deterministic", suiteName: options.suite.name,
    status, startedAt, completedAt, durationMs: Date.now() - started, results,
    ...(apiDesignAssessment ? { apiDesignAssessment } : {}),
    scope: [`HTTP API target origin: ${baseUrl.origin}`, `Target path prefix: ${baseUrl.pathname}`, `Executed API cases: ${selectedCases.length}/${options.suite.cases.length}${options.caseIds ? ` (selected ${selectedCases.map(item => item.id).join(", ")})` : " (full suite)"}`, ...(options.approvedSuite ? [`Approved API suite: ${options.approvedSuite.id} (SHA-256 ${options.approvedSuite.digest})`] : []), ...(options.suite.openApiCoverage ? [`OpenAPI operation trace coverage: ${options.suite.openApiCoverage.coveredOperationKeys.length}/${options.suite.openApiCoverage.operationKeys.length} operations cited by cases`, ...(options.suite.openApiCoverage.scenarios ? [`Scenario design evidence: success ${options.suite.openApiCoverage.scenarios.success.coveredOperationKeys.length}/${options.suite.openApiCoverage.scenarios.success.eligibleOperationKeys.length}; error ${options.suite.openApiCoverage.scenarios.error.coveredOperationKeys.length}/${options.suite.openApiCoverage.scenarios.error.eligibleOperationKeys.length}; authorization ${options.suite.openApiCoverage.scenarios.authorization.coveredOperationKeys.length}/${options.suite.openApiCoverage.scenarios.authorization.eligibleOperationKeys.length}; boundary checks ${options.suite.openApiCoverage.scenarios.boundary.checks?.filter(check => check.status === "covered").length ?? 0}/${options.suite.openApiCoverage.scenarios.boundary.checks?.length ?? 0} matched to case requests; manual boundary review ${options.suite.openApiCoverage.scenarios.boundary.manualReviewOperationKeys?.length ?? 0} operations`] : [])] : [])],
    ...(options.caseIds && options.rerunOf ? { apiRerun: { parentRunId: options.rerunOf, caseIds: selectedCases.map(item => item.id) } } : {}),
    limitations: ["API runner uses a fixed target origin, does not follow redirects, caps each response at 1 MB, and caps total evidence at 5 MB.", ...(options.suite.openApiCoverage?.scenarios ? ["OpenAPI design coverage counts are computed from expected statuses and case request values. A separate per-run assessment compares observed HTTP status classes for authored targets; this does not prove business semantics beyond the case's declared status, headers and JSON assertions. Value-level boundary matching supports scalar enum/numeric constraints, string lengths, and JSON arrays of simple scalar items; patterns, composed schemas, complex serialization and unsupported media types still require review."] : []), ...(evidenceWasCapped ? ["Some response evidence was truncated because this run exceeded the 5 MB evidence cap."] : []), ...(options.allowNetwork ? [] : ["Network targets are disabled unless --allow-network is explicitly supplied."]), ...(options.allowMutations ? [options.suite.fixtures ? "Mutating methods were enabled; user-authored setup/cleanup fixtures were attempted, but the runner does not independently verify that cleanup covers every created record." : "Mutating HTTP methods were explicitly enabled without suite fixtures; the suite owner is responsible for test-data isolation and cleanup."] : ["POST/PUT/PATCH/DELETE cases are blocked unless --allow-mutations is explicitly supplied."]), ...(options.allowConcurrency ? ["Concurrent request batches were explicitly enabled; concurrency is capped at 50 requests per case."] : ["Concurrent cases are blocked unless --allow-concurrency is explicitly supplied."]), ...(options.suite.principals ? ["API principal headers are loaded from the local suite; environment-variable credentials are redacted in evidence."] : []), ...(options.suite.fixtures ? ["Suite-declared fixture setup/cleanup uses this run ID; blocked requests and cleanup failures are visible in the run status."] : [])],
  };
  const { saveRun } = await import("../reporters/markdown-reporter.js");
  const recordPath = await saveRun(record, options.outputRoot);
  const runDirectory = path.dirname(recordPath);
  const suiteJson = `${JSON.stringify(options.suite, null, 2)}\n`;
  const report = await readFile(path.join(runDirectory, "report.md"), "utf8");
  const readme = [
    `# ${options.suite.name} · TestPilot API 回归包`, "",
    "本包包含可复用的、模型无关的 API 测试套件和本次运行证据。", "",
    "## 安全说明", "",
    "- 运行前确认目标环境；非本机地址需要显式启用 --allow-network。",
    "- POST/PUT/PATCH/DELETE 需要 --allow-mutations；并发需要 --allow-concurrency。",
    "- 凭据必须通过环境变量引用；不要把密钥直接写入套件。",
    "- 变更套件后，请重新审核；此 ZIP 保存的是本次执行的不可变快照。", "",
    "## 运行", "",
    "    $env:API_TOKEN = '<由安全渠道注入>'",
    "    npm run start -- run-api --suite suite.json", "",
    "需要外网、变更请求或并发时，按需追加对应显式开关。", "",
    "## 本次运行", "", `状态：${record.status}`, "", "报告：report.md", "",
  ].join("\n");
  const packagePath = path.join(runDirectory, "testpilot-api-suite.zip");
  await writeFile(path.join(runDirectory, "suite.json"), suiteJson, "utf8");
  await writeFile(path.join(runDirectory, "README.md"), readme, "utf8");
  const archive = zipSync({ "README.md": strToU8(readme), "suite.json": strToU8(suiteJson), "report.md": strToU8(report), "run.json": strToU8(`${JSON.stringify(record, null, 2)}\n`) });
  await mkdir(runDirectory, { recursive: true });
  await writeFile(packagePath, archive);
  return { record, recordPath, packagePath };
}

async function executeConfiguredCase(item: ApiTestCase, suite: ApiTestSuite, baseUrl: URL, allowMutations: boolean, allowConcurrency: boolean, runId: string, signal?: AbortSignal): Promise<CaseResult> {
    const concurrentRequests = item.concurrency ?? 1;
    if (concurrentRequests > 1 && !allowConcurrency) return result(item, "blocked", Date.now(), item.expect.status, null, "Concurrent requests require explicit --allow-concurrency; no request was sent.", [{ kind: "note", content: "Concurrent request batch was not started.", capturedAt: new Date().toISOString() }]);
    const { accessControl, ...baseCase } = item;
    const identities = accessControl?.principals ?? [undefined];
    const roleResults: Array<{ identity?: string; result: CaseResult }> = [];
    for (const identity of identities) {
      const roleDefinition = identity ? suite.principals?.[identity] : undefined;
      const expected = identity ? accessControl!.expectByPrincipal[identity]! : baseCase.expect;
      const roleCase: ApiTestCase = {
        ...baseCase,
        ...(identity ? { title: `${item.title} [${identity}]` } : {}),
        request: { ...baseCase.request, ...(identity || baseCase.request.headers ? { headers: { ...baseCase.request.headers, ...roleDefinition?.headers } } : {}) },
        expect: expected,
      };
      if (concurrentRequests === 1) roleResults.push({ ...(identity ? { identity } : {}), result: await executeApiCase(roleCase, baseUrl, allowMutations, runId, signal) });
      else {
        const batchStarted = Date.now();
        const batch = await Promise.all(Array.from({ length: concurrentRequests }, () => executeApiCase(roleCase, baseUrl, allowMutations, runId, signal)));
        roleResults.push({ ...(identity ? { identity } : {}), result: combineConcurrentResults(roleCase, batch, concurrentRequests, batchStarted) });
      }
    }
    return accessControl ? combinePrincipalResults(item, roleResults) : roleResults[0]!.result;
}

function combinePrincipalResults(item: ApiTestCase, entries: Array<{ identity?: string; result: CaseResult }>): CaseResult {
  const values = entries.map(entry => entry.result);
  const status: CaseResult["status"] = values.some(value => value.status === "error") ? "error"
    : values.some(value => value.status === "failed") ? "failed"
      : values.some(value => value.status === "blocked") ? "blocked" : "passed";
  const expected = entries.map(({ identity, result: value }) => `${identity ?? "default"}: ${value.assertion?.expected ?? "expected result"}`).join("; ");
  const actual = entries.map(({ identity, result: value }) => `${identity ?? "default"}: ${value.assertion?.actual ?? value.status}`).join("; ");
  const evidence = [{ kind: "note" as const, content: `Access-control matrix evaluated ${entries.length} identities: ${entries.map(entry => entry.identity).join(", ")}.`, capturedAt: new Date().toISOString() }, ...values.flatMap(value => value.evidence)];
  const errors = entries.flatMap(({ identity, result: value }) => value.error ? [`${identity ?? "default"}: ${value.error}`] : []);
  const apiObservations = entries.flatMap(({ identity, result: value }) => (value.apiObservations ?? []).map(observation => ({ ...observation, ...(identity ? { identity } : {}) })));
  return { caseId: item.id, title: `${item.title} (role matrix)`, status, durationMs: values.reduce((sum, value) => sum + value.durationMs, 0), assertion: { expected, actual }, apiObservations, ...(errors.length ? { error: errors.join("; ") } : {}), evidence };
}

function combineConcurrentResults(item: ApiTestCase, batch: CaseResult[], requestCount: number, started: number): CaseResult {
  const status: CaseResult["status"] = batch.some(value => value.status === "error") ? "error"
    : batch.some(value => value.status === "failed") ? "failed"
      : batch.some(value => value.status === "blocked") ? "blocked" : "passed";
  const actualStatuses = new Map<number, number>();
  for (const value of batch) if (value.actualExitCode !== null && value.actualExitCode !== undefined) actualStatuses.set(value.actualExitCode, (actualStatuses.get(value.actualExitCode) ?? 0) + 1);
  const actual = [...actualStatuses].map(([code, count]) => `HTTP ${code} × ${count}`).join(", ") || "No HTTP responses";
  const expected = batch[0]?.assertion?.expected ?? `HTTP ${item.expect.status}`;
  const evidence = [{ kind: "note" as const, content: `Concurrent batch launched ${requestCount} simultaneous requests.`, capturedAt: new Date().toISOString() }, ...batch.flatMap(value => value.evidence)];
  const errors = batch.map((value, index) => value.error ? `request ${index + 1}: ${value.error}` : "").filter(Boolean);
  const apiObservations = batch.flatMap(value => value.apiObservations ?? []);
  return { caseId: item.id, title: `${item.title} (${requestCount} concurrent requests)`, status, durationMs: Date.now() - started, assertion: { expected: `${expected} for each of ${requestCount} requests`, actual }, apiObservations, ...(errors.length ? { error: errors.join("; ") } : {}), evidence };
}

function capRunEvidence(results: CaseResult[]): boolean {
  let remaining = maxRunEvidenceBytes; let capped = false;
  for (const result of results) {
    const retained: EvidenceItem[] = [];
    for (const evidence of result.evidence) {
      if (remaining <= 0) { capped = true; continue; }
      const bytes = Buffer.from(evidence.content, "utf8");
      if (bytes.byteLength <= remaining) { retained.push(evidence); remaining -= bytes.byteLength; }
      else { retained.push({ ...evidence, content: new TextDecoder().decode(bytes.subarray(0, remaining)) }); remaining = 0; capped = true; }
    }
    result.evidence = retained;
  }
  return capped;
}

function selectApiCases(suite: ApiTestSuite, caseIds?: string[]): ApiTestCase[] {
  if (caseIds === undefined) return suite.cases;
  if (!Array.isArray(caseIds) || caseIds.length < 1 || caseIds.length > suite.cases.length || caseIds.some(id => typeof id !== "string" || !id.trim()) || new Set(caseIds).size !== caseIds.length) {
    throw new Error("Targeted API case selection must contain 1–suite-size unique case IDs.");
  }
  const byId = new Map(suite.cases.map(item => [item.id, item]));
  const selected = caseIds.map(id => byId.get(id));
  if (selected.some(item => !item)) throw new Error("Targeted API rerun may include only case IDs from the approved suite; fixtures run automatically around the selected cases.");
  return selected as ApiTestCase[];
}

async function executeApiCase(item: ApiTestCase, base: URL, allowMutations: boolean, runId: string, signal?: AbortSignal): Promise<CaseResult> {
  const started = Date.now();
  const capturedAt = new Date().toISOString();
  const expectedExitCode = item.expect.status;
  if (signal?.aborted) return result(item, "blocked", started, expectedExitCode, null, "Run cancelled before request.", [{ kind: "note", content: "HTTP request was not sent.", capturedAt }]);
  if (unsafeMethods.has(item.request.method) && !allowMutations) return result(item, "blocked", started, expectedExitCode, null, "Mutating HTTP method requires explicit --allow-mutations.", [{ kind: "note", content: "HTTP request was not sent.", capturedAt }]);
  const requestPath = item.request.path.replaceAll("${RUN_ID}", runId);
  const url = new URL(requestPath, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return result(item, "blocked", started, expectedExitCode, null, "Request escaped the configured target origin/path prefix.", [{ kind: "note", content: "HTTP request was not sent.", capturedAt }]);
  const controller = new AbortController();
  const timeoutMs = item.request.timeoutMs ?? 10_000;
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs} ms.`)), timeoutMs);
  const cancel = () => controller.abort(new Error("Run cancelled."));
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const headers = resolveHeaders(item.request.headers ?? {}, runId);
    const body = item.request.body === undefined ? undefined : JSON.stringify(resolveEnvValues(item.request.body, runId));
    if (body !== undefined && !Object.keys(headers).some(key => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
    const response = await fetch(url, { method: item.request.method, headers, ...(body !== undefined ? { body } : {}), redirect: "manual", signal: controller.signal });
    const bodyText = await readLimitedBody(response);
    let parsed: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (/\bjson\b/i.test(contentType) && bodyText) { try { parsed = JSON.parse(bodyText); } catch { parsed = undefined; } }
    const mismatches: string[] = [];
    if (response.status !== item.expect.status) mismatches.push(`status expected ${item.expect.status}, got ${response.status}`);
    for (const [name, expected] of Object.entries(item.expect.headers ?? {})) {
      const actual = response.headers.get(name);
      if (actual !== expected) mismatches.push(`header ${name} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    if (Object.hasOwn(item.expect, "json")) {
      if (parsed === undefined) mismatches.push("expected JSON response but body was not valid JSON");
      else compareSubset(item.expect.json, parsed, "$", mismatches);
    }
    const durationMs = Date.now() - started;
    if (item.expect.maxDurationMs !== undefined && durationMs > item.expect.maxDurationMs) mismatches.push(`duration expected <= ${item.expect.maxDurationMs} ms, got ${durationMs} ms`);
    const safeHeaders = redactHeaders(headers);
    const responseEvidence = JSON.stringify(scrub(parsed ?? bodyText));
    const evidence: EvidenceItem[] = [
      { kind: "note", content: `Request: ${item.request.method} ${redactUrl(url)} headers=${JSON.stringify(safeHeaders)}${body === undefined ? "" : ` body=${JSON.stringify(scrub(JSON.parse(body)))}`}`, capturedAt },
      { kind: "stdout", content: `HTTP ${response.status}\nheaders=${JSON.stringify(redactResponseHeaders(response.headers))}\nbody=${responseEvidence.slice(0, maxBodyBytes)}`, capturedAt: new Date().toISOString() },
    ];
    return result(item, mismatches.length ? "failed" : "passed", started, expectedExitCode, response.status, mismatches.join("; ") || undefined, evidence);
  } catch (error) {
    const timedOut = controller.signal.aborted && !signal?.aborted;
    const message = signal?.aborted ? `Request cancelled: ${signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "cancelled by user")}` : error instanceof Error ? error.message : String(error);
    return result(item, signal?.aborted ? "blocked" : timedOut ? "failed" : "error", started, expectedExitCode, null, message, [{ kind: timedOut ? "timeout" : "stderr", content: message, capturedAt: new Date().toISOString() }]);
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
}

function result(item: ApiTestCase, status: CaseResult["status"], started: number, expected: number, actual: number | null, error?: string, evidence: EvidenceItem[] = []): CaseResult {
  const expectedDescription = JSON.stringify(scrub({ status: item.expect.status, headers: item.expect.headers, json: item.expect.json, maxDurationMs: item.expect.maxDurationMs }));
  const actualDescription = actual === null ? "No HTTP response" : `HTTP ${actual}`;
  const designTrace = {
    ...(item.source ? { source: item.source } : {}),
    ...(item.requirementRefs?.length ? { requirementRefs: item.requirementRefs } : {}),
    ...(item.priority ? { priority: item.priority } : {}),
  };
  const trace = [designTrace.source ? `Source: ${designTrace.source}` : "", designTrace.requirementRefs?.length ? `Requirements: ${designTrace.requirementRefs.join("; ")}` : "", designTrace.priority ? `Priority: ${designTrace.priority}` : ""].filter(Boolean).join("\n");
  const tracedEvidence = trace ? [{ kind: "note" as const, content: trace, capturedAt: new Date().toISOString() }, ...evidence] : evidence;
  return { caseId: item.id, title: item.title, status, durationMs: Date.now() - started, assertion: { expected: expectedDescription, actual: actualDescription }, apiObservations: [{ expectedStatus: item.expect.status, actualStatus: actual }], ...(Object.keys(designTrace).length ? { designTrace } : {}), ...(error ? { error } : {}), evidence: tracedEvidence };
}

function buildApiDesignAssessment(suite: ApiTestSuite, results: CaseResult[]): { checks: ApiDesignAssessmentCheck[] } | undefined {
  const coverage = suite.openApiCoverage;
  if (!coverage?.operationFacts?.length || !coverage.scenarios) return undefined;
  const checks: ApiDesignAssessmentCheck[] = [];
  const operationFacts = new Map(coverage.operationFacts.map(fact => [fact.key, fact]));
  const resultByCaseId = new Map(results.map(value => [value.caseId, value]));
  const testCasesByOperation = new Map<string, ApiTestCase[]>();
  for (const item of suite.cases) {
    const operationKey = coverage.operationFacts.find(fact => item.source === `OpenAPI: ${fact.key}` && caseMatchesOperationRoute(suite, item, fact.key))?.key;
    if (operationKey) testCasesByOperation.set(operationKey, [...(testCasesByOperation.get(operationKey) ?? []), item]);
  }
  const appendCategory = (category: "success" | "error" | "authorization", scenario: ApiOpenApiScenarioCoverage) => {
    for (const operationKey of scenario.eligibleOperationKeys) {
      const candidates = (testCasesByOperation.get(operationKey) ?? []).filter(item => category === "success"
        ? item.expect.status >= 200 && item.expect.status < 300
        : category === "error"
          ? item.expect.status >= 400 && item.expect.status < 500
          : item.accessControl ? Object.values(item.accessControl.expectByPrincipal).some(expectation => expectation.status === 401 || expectation.status === 403) : item.expect.status === 401 || item.expect.status === 403);
      const expectedResponse = category === "success" ? "2xx" : category === "error" ? "4xx" : "401/403";
      if (!candidates.length) {
        checks.push({ category, operationKey, label: categoryLabel(category), expectedResponse, observedStatuses: [], status: "not-authored" });
        continue;
      }
      for (const item of candidates) checks.push(assessCase(category, operationKey, categoryLabel(category), expectedResponse, item.id, categoryObservations(category, resultByCaseId.get(item.id)), undefined, resultByCaseId.get(item.id)));
    }
  };
  appendCategory("success", coverage.scenarios.success);
  appendCategory("error", coverage.scenarios.error);
  appendCategory("authorization", coverage.scenarios.authorization);
  for (const boundary of coverage.scenarios.boundary.checks ?? []) {
    const fact = operationFacts.get(boundary.operationKey);
    const requirement = fact?.boundaryRequirements?.find(item => item.id === boundary.requirementId);
    const expectedResponse = requirement?.expectedStatus ?? "error";
    if (!boundary.caseIds.length) {
      checks.push({ category: "boundary", operationKey: boundary.operationKey, requirementId: boundary.requirementId, label: boundary.label, expectedResponse: expectedResponse === "success" ? "2xx" : "4xx", observedStatuses: [], status: "not-authored" });
      continue;
    }
    for (const caseId of boundary.caseIds) {
      const caseResult = resultByCaseId.get(caseId);
      const observations = (caseResult?.apiObservations ?? []).filter(value => expectedResponse === "success" ? value.expectedStatus >= 200 && value.expectedStatus < 300 : value.expectedStatus >= 400 && value.expectedStatus < 500);
      checks.push(assessCase("boundary", boundary.operationKey, boundary.label, expectedResponse === "success" ? "2xx" : "4xx", caseId, observations, boundary.requirementId, caseResult));
    }
  }
  for (const operationKey of coverage.scenarios.boundary.manualReviewOperationKeys ?? []) checks.push({ category: "manual-review", operationKey, label: "Complex boundary constraints require manual review", expectedResponse: "manual review", observedStatuses: [], status: "manual-review" });
  return { checks };
}

function categoryObservations(category: "success" | "error" | "authorization", value?: CaseResult) {
  const observations = value?.apiObservations ?? [];
  return category === "authorization" ? observations.filter(observation => observation.expectedStatus === 401 || observation.expectedStatus === 403) : observations;
}

function assessCase(category: ApiDesignAssessmentCheck["category"], operationKey: string, label: string, expectedResponse: ApiDesignAssessmentCheck["expectedResponse"], caseId: string, observations: Array<{ expectedStatus: number; actualStatus: number | null }>, requirementId?: string, result?: CaseResult): ApiDesignAssessmentCheck {
  const actual = observations.map(observation => observation.actualStatus).filter((status): status is number => status !== null);
  const answered = observations.length > 0 && actual.length === observations.length;
  const conforms = answered && actual.every(status => expectedResponse === "2xx" ? status >= 200 && status < 300 : expectedResponse === "4xx" ? status >= 400 && status < 500 : expectedResponse === "401/403" ? status === 401 || status === 403 : false);
  return { category: category as Exclude<ApiDesignAssessmentCheck["category"], "manual-review">, operationKey, ...(requirementId ? { requirementId } : {}), label, caseId, expectedResponse: expectedResponse as Exclude<ApiDesignAssessmentCheck["expectedResponse"], "manual review">, observedStatuses: actual, ...(result ? { resultStatus: result.status } : {}), status: !result ? "not-run" : !observations.length || actual.length === 0 ? "no-response" : !answered ? "partial-response" : conforms ? "confirmed" : "mismatch" };
}

function categoryLabel(category: "success" | "error" | "authorization"): string {
  return category === "success" ? "Successful response" : category === "error" ? "Error response" : "Authorization denial";
}
function validateTargetBase(input: string, allowNetwork: boolean): URL {
  let base: URL;
  try { base = new URL(input); } catch { throw new Error("API target must be an absolute HTTP(S) URL."); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("API target must use HTTP(S) and contain no credentials, query or fragment.");
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]";
  if (!local && !allowNetwork) throw new Error("Non-loopback API targets require explicit --allow-network.");
  base.pathname = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return base;
}
function resolveHeaders(input: Record<string, string>, runId: string): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.replace(/\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined) throw new Error(`Required environment variable ${name} is not set.`);
    return resolved;
  }).replaceAll("${RUN_ID}", runId)]));
}
function resolveEnvValues(input: unknown, runId: string): unknown {
  if (typeof input === "string") return input.replace(/\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = process.env[name]; if (resolved === undefined) throw new Error(`Required environment variable ${name} is not set.`); return resolved;
  }).replaceAll("${RUN_ID}", runId);
  if (Array.isArray(input)) return input.map(value => resolveEnvValues(value, runId));
  if (typeof input === "object" && input !== null) return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, resolveEnvValues(value, runId)]));
  return input;
}
function compareSubset(expected: unknown, actual: unknown, path: string, failures: string[]): void {
  if (typeof expected !== "object" || expected === null || Array.isArray(expected)) {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) failures.push(`${path} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) { failures.push(`${path} expected an object, got ${JSON.stringify(actual)}`); return; }
  for (const [key, value] of Object.entries(expected)) {
    if (!Object.hasOwn(actual, key)) failures.push(`${path}.${key} is missing`);
    else compareSubset(value, (actual as Record<string, unknown>)[key], `${path}.${key}`, failures);
  }
}
async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBodyBytes) { await reader.cancel(); throw new Error(`Response body exceeds ${maxBodyBytes} bytes.`); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(buffer);
}
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /token|password|secret|authorization|cookie|(?:api|access|private|signing|client)[_-]?key/i.test(key) ? "[REDACTED]" : scrub(entry)]));
  return value;
}
function redactHeaders(headers: Record<string, string>): Record<string, string> { return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, /authorization|cookie|token|secret|(?:api|access|private|signing|client)[_-]?key/i.test(key) ? "[REDACTED]" : value])); }
function redactResponseHeaders(headers: Headers): Record<string, string> { return Object.fromEntries([...headers.entries()].map(([key, value]) => [key, /set-cookie|authorization|token|secret|(?:api|access|private|signing|client)[_-]?key/i.test(key) ? "[REDACTED]" : value])); }
function redactUrl(url: URL): string { const safe = new URL(url); for (const key of [...safe.searchParams.keys()]) safe.searchParams.set(key, "[REDACTED]"); return safe.href; }
