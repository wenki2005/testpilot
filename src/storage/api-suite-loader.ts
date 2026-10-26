import { readFile } from "node:fs/promises";
import { caseMatchesOperationRoute, findCasesCoveringBoundary, type OpenApiBoundaryRequirement, type OpenApiBoundaryEvidence } from "./openapi-boundary.js";

export type ApiMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ApiExpectation = { status: number; json?: unknown; headers?: Record<string, string>; maxDurationMs?: number };
export type ApiPrincipal = { headers?: Record<string, string> };
export type ApiFixtures = { setup: ApiTestCase[]; cleanup: ApiTestCase[] };
export type ApiTestCase = {
  id: string;
  title: string;
  source?: string;
  requirementRefs?: string[];
  priority?: "P0" | "P1" | "P2" | "P3";
  request: { method: ApiMethod; path: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number };
  concurrency?: number;
  expect: ApiExpectation;
  accessControl?: { principals: string[]; expectByPrincipal: Record<string, ApiExpectation> };
};
export type ApiOpenApiOperationFact = { key: string; declaredStatuses: string[]; securityRequired: boolean; hasBoundaryConstraints: boolean; requiresManualBoundaryReview?: boolean; boundaryRequirements?: OpenApiBoundaryRequirement[] };
export type ApiOpenApiScenarioCoverage = { eligibleOperationKeys: string[]; coveredOperationKeys: string[]; uncoveredOperationKeys: string[]; checks?: OpenApiBoundaryEvidence[]; manualReviewOperationKeys?: string[] };
export type ApiOpenApiCoverage = {
  operationKeys: string[];
  coveredOperationKeys: string[];
  uncoveredOperationKeys: string[];
  operationFacts?: ApiOpenApiOperationFact[];
  scenarios?: { success: ApiOpenApiScenarioCoverage; error: ApiOpenApiScenarioCoverage; authorization: ApiOpenApiScenarioCoverage; boundary: ApiOpenApiScenarioCoverage };
};
export type ApiTestSuite = { version: 1; name: string; description?: string; baseUrl?: string; principals?: Record<string, ApiPrincipal>; fixtures?: ApiFixtures; openApiCoverage?: ApiOpenApiCoverage; cases: ApiTestCase[] };

export async function loadApiSuite(filePath: string): Promise<ApiTestSuite> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  return parseApiSuite(parsed);
}

export function parseApiSuite(parsed: unknown): ApiTestSuite {
  if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.name !== "string" || !parsed.name.trim() || !Array.isArray(parsed.cases) || parsed.cases.length > 500) {
    throw new Error("Invalid API suite: expected version: 1, name and at most 500 cases.");
  }
  const principals = validatePrincipals(parsed.principals);
  const cases = parsed.cases.map((item, index) => validateCase(item, index, principals));
  const fixtures = validateFixtures(parsed.fixtures, principals);
  const mutatingCases = [...cases, ...(fixtures?.setup ?? [])].filter(item => ["POST", "PUT", "PATCH", "DELETE"].includes(item.request.method));
  if (mutatingCases.length && !fixtures?.cleanup.length) throw new Error("Mutating API cases require explicit fixtures.cleanup steps.");
  if (mutatingCases.some(item => !containsRunId(item.request))) throw new Error("Mutating API setup/cases must use ${RUN_ID} in the request path, headers or JSON body for per-run isolation.");
  if (mutatingCases.length && !fixtures!.cleanup.some(item => containsRunId(item.request))) throw new Error("Mutating API cases require cleanup that targets ${RUN_ID}.");
  const ids = new Set<string>();
  for (const item of [...(fixtures?.setup ?? []), ...cases, ...(fixtures?.cleanup ?? [])]) {
    if (ids.has(item.id)) throw new Error(`Duplicate API case ID: ${item.id}`);
    ids.add(item.id);
  }
  const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined;
  if (baseUrl) validateBaseUrl(baseUrl);
  return { version: 1, name: parsed.name.trim(), ...(typeof parsed.description === "string" ? { description: parsed.description } : {}), ...(baseUrl ? { baseUrl } : {}), ...(principals ? { principals } : {}), ...(fixtures ? { fixtures } : {}), cases };
}

export function calculateOpenApiCoverage(suite: ApiTestSuite, operationKeys: string[], operationFacts: ApiOpenApiOperationFact[] = []): ApiOpenApiCoverage {
  const uniqueKeys = [...new Set(operationKeys)];
  const factsByKey = new Map(operationFacts.filter(fact => uniqueKeys.includes(fact.key)).map(fact => [fact.key, {
    ...fact, declaredStatuses: [...new Set(fact.declaredStatuses)],
  }]));
  const casesByOperation = new Map<string, ApiTestCase[]>();
  for (const item of suite.cases) {
    const match = item.source?.match(/^OpenAPI:\s+(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\s+(\/\S*)$/);
    if (!match) continue;
    const key = `${match[1]} ${match[2]}`;
    const fact = factsByKey.get(key);
    if (!uniqueKeys.includes(key) || !caseMatchesOperationRoute(suite, item, key)) continue;
    if (fact) {
      const statuses = [item.expect.status, ...Object.values(item.accessControl?.expectByPrincipal ?? {}).map(expectation => expectation.status)];
      if (statuses.some(status => !fact.declaredStatuses.includes(String(status)) && !fact.declaredStatuses.includes("default"))) continue;
    }
    casesByOperation.set(key, [...(casesByOperation.get(key) ?? []), item]);
  }
  const coveredOperationKeys = uniqueKeys.filter(key => casesByOperation.has(key));
  const makeScenario = (eligible: string[], covered: (key: string) => boolean): ApiOpenApiScenarioCoverage => ({
    eligibleOperationKeys: eligible,
    coveredOperationKeys: eligible.filter(covered),
    uncoveredOperationKeys: eligible.filter(key => !covered(key)),
  });
  const statusCase = (key: string, predicate: (status: number) => boolean) => (casesByOperation.get(key) ?? []).some(item => predicate(item.expect.status));
  const authCase = (key: string) => (casesByOperation.get(key) ?? []).some(item => {
    if (item.accessControl) return Object.values(item.accessControl.expectByPrincipal).some(expectation => expectation.status === 401 || expectation.status === 403);
    return item.expect.status === 401 || item.expect.status === 403;
  });
  const eligibleSuccess = uniqueKeys;
  const eligibleError = uniqueKeys.filter(key => factsByKey.get(key)?.declaredStatuses.some(status => status === "default" || /^4\d\d$/.test(status)));
  const eligibleAuthorization = uniqueKeys.filter(key => factsByKey.get(key)?.securityRequired);
  const eligibleBoundary = uniqueKeys.filter(key => factsByKey.get(key)?.hasBoundaryConstraints);
  const boundaryChecks: OpenApiBoundaryEvidence[] = eligibleBoundary.flatMap(operationKey => {
    const requirements = factsByKey.get(operationKey)?.boundaryRequirements ?? [];
    return requirements.map(requirement => {
      const caseIds = findCasesCoveringBoundary(suite, casesByOperation.get(operationKey) ?? [], operationKey, requirement);
      return { operationKey, requirementId: requirement.id, label: requirement.label, status: caseIds.length ? "covered" as const : "missing" as const, caseIds };
    });
  });
  const manualReviewOperationKeys = eligibleBoundary.filter(key => factsByKey.get(key)?.requiresManualBoundaryReview === true || !(factsByKey.get(key)?.boundaryRequirements?.length));
  const coveredBoundaryKeys = eligibleBoundary.filter(key => {
    const required = boundaryChecks.filter(check => check.operationKey === key);
    return !manualReviewOperationKeys.includes(key) && required.length > 0 && required.every(check => check.status === "covered");
  });
  return {
    operationKeys: uniqueKeys,
    coveredOperationKeys,
    uncoveredOperationKeys: uniqueKeys.filter(key => !casesByOperation.has(key)),
    ...(factsByKey.size ? {
      operationFacts: [...factsByKey.values()],
      scenarios: {
        success: makeScenario(eligibleSuccess, key => statusCase(key, status => status >= 200 && status < 300)),
        error: makeScenario(eligibleError, key => statusCase(key, status => status >= 400 && status < 500)),
        authorization: makeScenario(eligibleAuthorization, authCase),
        // Supported scalar constraints are matched to concrete case values. Unsupported schema
        // features remain explicit manual-review items instead of being counted as covered.
        boundary: {
          ...makeScenario(eligibleBoundary, key => coveredBoundaryKeys.includes(key)),
          checks: boundaryChecks,
          manualReviewOperationKeys,
        },
      },
    } : {}),
  };
}


function validateFixtures(value: unknown, principals?: Record<string, ApiPrincipal>): ApiFixtures | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Array.isArray(value.setup) || !Array.isArray(value.cleanup) || value.setup.length > 10 || value.cleanup.length > 10) throw new Error("fixtures requires setup and cleanup arrays of at most 10 steps each.");
  const setup = value.setup.map((item, index) => validateCase(item, index, principals));
  const cleanup = value.cleanup.map((item, index) => validateCase(item, index, principals));
  if ([...setup, ...cleanup].some(item => item.concurrency !== undefined || item.accessControl !== undefined)) throw new Error("Fixture lifecycle steps cannot use concurrency or role matrices.");
  if (setup.some(item => ["POST", "PUT", "PATCH", "DELETE"].includes(item.request.method)) && cleanup.length === 0) throw new Error("Mutating fixture setup requires an explicit cleanup step.");
  return { setup, cleanup };
}

function containsRunId(value: unknown): boolean {
  if (typeof value === "string") return value.includes("${RUN_ID}");
  if (Array.isArray(value)) return value.some(containsRunId);
  if (typeof value === "object" && value !== null) return Object.values(value).some(containsRunId);
  return false;
}

function validateCase(value: unknown, index: number, principals?: Record<string, ApiPrincipal>): ApiTestCase {
  if (!isRecord(value) || !safeText(value.id, 1, 120) || !safeText(value.title, 1, 300) || !isRecord(value.request)) throw new Error(`Invalid API case at index ${index}.`);
  if (value.source !== undefined && !safeText(value.source, 1, 500)) throw new Error(`Case ${value.id}: source must be safe text up to 500 characters.`);
  if (value.requirementRefs !== undefined && (!Array.isArray(value.requirementRefs) || value.requirementRefs.length > 10 || !value.requirementRefs.every((item: unknown) => safeText(item, 1, 500)))) throw new Error(`Case ${value.id}: requirementRefs must contain at most 10 safe references.`);
  if (value.priority !== undefined && !isPriority(value.priority)) throw new Error(`Case ${value.id}: priority must be P0, P1, P2 or P3.`);
  const request = value.request;
  const expect = validateExpectation(value.expect, `Case ${value.id}: expect`);
  const methods: ApiMethod[] = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];
  if (typeof request.method !== "string" || !methods.includes(request.method as ApiMethod)) throw new Error(`Case ${value.id}: unsupported HTTP method.`);
  if (typeof request.path !== "string" || !request.path.startsWith("/") || request.path.startsWith("//") || request.path.includes("\\") || /[\r\n]/.test(request.path)) throw new Error(`Case ${value.id}: path must be an origin-relative path beginning with a single slash.`);
  const headers = validateRequestHeaders(request.headers, `Case ${value.id}: request.headers`);
  const timeoutMs = request.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 100 || (timeoutMs as number) > 120_000) throw new Error(`Case ${value.id}: timeoutMs must be 100–120000.`);
  const maxDurationMs = expect.maxDurationMs;
  if (maxDurationMs !== undefined && (!Number.isInteger(maxDurationMs) || (maxDurationMs as number) < 1 || (maxDurationMs as number) > 120_000)) throw new Error(`Case ${value.id}: expect.maxDurationMs must be 1–120000.`);
  if (request.body !== undefined && !["POST", "PUT", "PATCH", "DELETE"].includes(request.method as string)) throw new Error(`Case ${value.id}: request body is only allowed for POST/PUT/PATCH/DELETE.`);
  const concurrency = value.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || (concurrency as number) < 1 || (concurrency as number) > 50) throw new Error(`Case ${value.id}: concurrency must be 1–50.`);
  let accessControl: ApiTestCase["accessControl"];
  if (value.accessControl !== undefined) {
    if (!isRecord(value.accessControl) || !Array.isArray(value.accessControl.principals) || value.accessControl.principals.length < 2 || value.accessControl.principals.length > 20 || !isRecord(value.accessControl.expectByPrincipal)) throw new Error(`Case ${value.id}: accessControl requires 2–20 principals and expectByPrincipal.`);
    const roleIds = value.accessControl.principals;
    if (!roleIds.every(role => typeof role === "string" && principals?.[role]) || new Set(roleIds).size !== roleIds.length) throw new Error(`Case ${value.id}: accessControl references unknown or duplicate principals.`);
    const expectations = value.accessControl.expectByPrincipal;
    const expectedIds = new Set(roleIds as string[]);
    if (Object.keys(expectations).length !== expectedIds.size || Object.keys(expectations).some(role => !expectedIds.has(role))) throw new Error(`Case ${value.id}: expectByPrincipal must define exactly one expectation for every principal.`);
    accessControl = { principals: roleIds as string[], expectByPrincipal: Object.fromEntries((roleIds as string[]).map(role => [role, validateExpectation(expectations[role], `Case ${value.id}: expectation for ${role}`)])) };
  }
  return {
    id: value.id, title: value.title,
    ...(typeof value.source === "string" && value.source.trim() ? { source: value.source.trim().slice(0, 500) } : {}),
    ...(Array.isArray(value.requirementRefs) ? { requirementRefs: value.requirementRefs.map((item: string) => item.trim()) } : {}),
    ...(isPriority(value.priority) ? { priority: value.priority } : {}),
    request: { method: request.method as ApiMethod, path: request.path, ...(headers ? { headers } : {}), ...(request.body !== undefined ? { body: request.body } : {}), timeoutMs: timeoutMs as number },
    ...(concurrency > 1 ? { concurrency: concurrency as number } : {}),
    expect,
    ...(accessControl ? { accessControl } : {}),
  };
}

function validateExpectation(value: unknown, label: string): ApiExpectation {
  if (!isRecord(value) || !Number.isInteger(value.status) || (value.status as number) < 100 || (value.status as number) > 599) throw new Error(`${label}.status must be an HTTP status code.`);
  const headers = validateStringMap(value.headers, `${label}.headers`);
  const maxDurationMs = value.maxDurationMs;
  if (maxDurationMs !== undefined && (!Number.isInteger(maxDurationMs) || (maxDurationMs as number) < 1 || (maxDurationMs as number) > 120_000)) throw new Error(`${label}.maxDurationMs must be 1–120000.`);
  return { status: value.status as number, ...(Object.hasOwn(value, "json") ? { json: value.json } : {}), ...(headers ? { headers } : {}), ...(maxDurationMs !== undefined ? { maxDurationMs: maxDurationMs as number } : {}) };
}

function validatePrincipals(value: unknown): Record<string, ApiPrincipal> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Object.keys(value).length || Object.keys(value).length > 20) throw new Error("principals must define between 1 and 20 named identities.");
  const result: Record<string, ApiPrincipal> = {};
  for (const [id, principal] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(id) || !isRecord(principal)) throw new Error(`Invalid API principal: ${id}.`);
    const headers = validateRequestHeaders(principal.headers, `Principal ${id}: headers`);
    result[id] = headers ? { headers } : {};
  }
  return result;
}

function validateBaseUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("API baseUrl must be an absolute HTTP(S) URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("API baseUrl must use HTTP(S), contain no credentials, query or fragment.");
  return url;
}

function validateStringMap(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Object.entries(value).every(([key, entry]) => safeText(key, 1, 200) && typeof entry === "string" && entry.length <= 10_000 && !/[\r\n]/.test(key + entry))) throw new Error(`${label} must be a map of safe strings.`);
  return value as Record<string, string>;
}
function validateRequestHeaders(value: unknown, label: string): Record<string, string> | undefined {
  const headers = validateStringMap(value, label);
  for (const [key, content] of Object.entries(headers ?? {})) {
    if (/authorization|cookie|token|secret|(?:api|access|private|signing|client)[_-]?key/i.test(key) && content && !/\$\{ENV:[A-Za-z_][A-Za-z0-9_]*\}/.test(content)) {
      throw new Error(`${label}: credential header ${key} must use a \${ENV:VARIABLE_NAME} reference.`);
    }
  }
  return headers;
}
function safeText(value: unknown, min: number, max: number): value is string { return typeof value === "string" && value.trim().length >= min && value.length <= max && !/[\r\n]/.test(value); }
function isPriority(value: unknown): value is NonNullable<ApiTestCase["priority"]> { return value === "P0" || value === "P1" || value === "P2" || value === "P3"; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
