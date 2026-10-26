import type { ApiTestCase, ApiTestSuite } from "./api-suite-loader.js";

export type OpenApiBoundaryRequirement = {
  id: string;
  label: string;
  locator: { in: "query" | "path" | "header" | "cookie" | "body"; name?: string; jsonPath?: string[] };
  value: unknown;
  expectedStatus: "success" | "error";
};

export type OpenApiBoundaryEvidence = {
  operationKey: string;
  requirementId: string;
  label: string;
  status: "covered" | "missing";
  caseIds: string[];
};

export function extractOpenApiBoundaryRequirements(operation: Record<string, any>, openApiVersion = "3.1.0"): OpenApiBoundaryRequirement[] {
  const key = `${String(operation.method)} ${String(operation.path)}`;
  const result: OpenApiBoundaryRequirement[] = [];
  const addSchema = (schema: unknown, label: string, locator: OpenApiBoundaryRequirement["locator"], path: string[], depth: number) => {
    if (!isRecord(schema) || depth > 5 || result.length >= 100) return;
    const base = { ...locator, ...(path.length ? { jsonPath: path } : {}) };
    if (Array.isArray(schema.enum)) {
      schema.enum.slice(0, 20).forEach((value: unknown, index: number) => {
        if (isBoundaryScalar(value)) result.push(makeRequirement(key, `${label} enum value ${String(value)}`, base, value, "success", `enum-${index}`));
      });
    }
    const isOas30 = openApiVersion.startsWith("3.0.");
    const lower = isOas30 && schema.exclusiveMinimum === true ? { value: schema.minimum, expected: "error" as const, suffix: "exclusiveMinimum" } : { value: schema.minimum, expected: "success" as const, suffix: "minimum" };
    const upper = isOas30 && schema.exclusiveMaximum === true ? { value: schema.maximum, expected: "error" as const, suffix: "exclusiveMaximum" } : { value: schema.maximum, expected: "success" as const, suffix: "maximum" };
    if (typeof lower.value === "number" && Number.isFinite(lower.value)) result.push(makeRequirement(key, `${label} ${lower.suffix} ${lower.value}`, base, lower.value, lower.expected, lower.suffix));
    if (typeof upper.value === "number" && Number.isFinite(upper.value)) result.push(makeRequirement(key, `${label} ${upper.suffix} ${upper.value}`, base, upper.value, upper.expected, upper.suffix));
    if (!isOas30) {
      for (const constraint of ["exclusiveMinimum", "exclusiveMaximum"] as const) {
        const value = schema[constraint];
        if (typeof value === "number" && Number.isFinite(value)) result.push(makeRequirement(key, `${label} ${constraint} ${value}`, base, value, "error", constraint));
      }
    }
    if (schema.type === "string") {
      for (const constraint of ["minLength", "maxLength"] as const) {
        const size = schema[constraint];
        if (!Number.isInteger(size) || size < 0 || size > 500) continue;
        result.push(makeRequirement(key, `${label} ${constraint} ${size}`, base, "a".repeat(size), "success", constraint));
        if (constraint === "minLength" && size > 0) result.push(makeRequirement(key, `${label} shorter than minLength ${size}`, base, "a".repeat(size - 1), "error", `${constraint}-below`));
        if (constraint === "maxLength") result.push(makeRequirement(key, `${label} longer than maxLength ${size}`, base, "a".repeat(size + 1), "error", `${constraint}-above`));
      }
    }
    if (schema.type === "array") {
      const item = sampleScalarArrayItem(schema.items);
      if (item.supported) {
        for (const constraint of ["minItems", "maxItems"] as const) {
          const size = schema[constraint];
          if (!Number.isInteger(size) || size < 0 || size > 100) continue;
          result.push(makeRequirement(key, `${label} ${constraint} ${size}`, base, Array.from({ length: size }, () => item.value), "success", constraint));
          if (constraint === "minItems" && size > 0) result.push(makeRequirement(key, `${label} fewer than minItems ${size}`, base, Array.from({ length: size - 1 }, () => item.value), "error", `${constraint}-below`));
          if (constraint === "maxItems") result.push(makeRequirement(key, `${label} more than maxItems ${size}`, base, Array.from({ length: size + 1 }, () => item.value), "error", `${constraint}-above`));
        }
      }
    }
    if (isRecord(schema.properties)) {
      for (const [name, child] of Object.entries(schema.properties).slice(0, 30)) addSchema(child, `${label}.${name}`, locator, [...path, name], depth + 1);
    }
  };

  for (const parameter of (operation.parameters as Array<Record<string, any>> | undefined) ?? []) {
    const location = parameter.in;
    const name = parameter.name;
    if (!["query", "path", "header", "cookie"].includes(location) || typeof name !== "string") continue;
    addSchema(parameter.schema, `${location} parameter ${name}`, { in: location, name }, [], 0);
  }
  const body = operation.requestBody as Record<string, any> | undefined;
  const content = body?.content as Record<string, any> | undefined;
  const jsonSchema = content?.["application/json"]?.schema ?? content?.["application/*+json"]?.schema;
  if (jsonSchema) addSchema(jsonSchema, "request body", { in: "body" }, [], 0);
  return result;
}

export function openApiRequiresManualBoundaryReview(operation: Record<string, any>): boolean {
  const checks: Array<{ schema: unknown; location: string; depth: number }> = [
    ...((operation.parameters as Array<Record<string, any>> | undefined ?? []).map(parameter => ({ schema: parameter.schema, location: String(parameter.in), depth: 0 }))),
    ...Object.values((operation.requestBody as Record<string, any> | undefined)?.content ?? {}).map((media: any) => ({ schema: media?.schema, location: "body", depth: 0 })),
  ];
  let visited = 0;
  while (checks.length && visited < 2_000) {
    const { schema, location, depth } = checks.pop()!;
    if (!isRecord(schema)) continue;
    visited++;
    if (depth > 8 || ["pattern", "oneOf", "anyOf", "allOf", "not", "uniqueItems"].some(key => Object.hasOwn(schema, key))) return true;
    if (Array.isArray(schema.enum) && schema.enum.length > 20) return true;
    if (schema.type === "string") {
      if ([schema.minLength, schema.maxLength].some(value => typeof value === "number" && value > 500)) return true;
      continue;
    }
    if (schema.type === "array") {
      if ([schema.minItems, schema.maxItems].some(value => typeof value === "number" && value > 100)) return true;
      if (location !== "body" || !isSimpleArrayItem(schema.items)) return true;
      continue;
    }
    if (schema.type === "object") {
      if (!isRecord(schema.properties)) return true;
      for (const child of Object.values(schema.properties)) checks.push({ schema: child, location, depth: depth + 1 });
    }
  }
  return checks.length > 0;
}

export function findCasesCoveringBoundary(
  suite: ApiTestSuite,
  cases: ApiTestCase[],
  operationKey: string,
  requirement: OpenApiBoundaryRequirement,
): string[] {
  return cases.filter(item => {
    if (!requestHasBoundaryValue(suite, item, operationKey, requirement)) return false;
    return requirement.expectedStatus === "success"
      ? item.expect.status >= 200 && item.expect.status < 300
      : item.expect.status >= 400 && item.expect.status < 500;
  }).map(item => item.id);
}

export function caseMatchesOperationRoute(suite: ApiTestSuite, item: ApiTestCase, operationKey: string): boolean {
  const separator = operationKey.indexOf(" ");
  const method = operationKey.slice(0, separator);
  const route = operationKey.slice(separator + 1);
  if (item.request.method !== method) return false;
  return matchOperationPath(suite, item.request.path, route) !== undefined;
}

function requestHasBoundaryValue(suite: ApiTestSuite, item: ApiTestCase, operationKey: string, requirement: OpenApiBoundaryRequirement): boolean {
  let candidate: unknown;
  const { in: location, name, jsonPath = [] } = requirement.locator;
  if (location === "body") {
    candidate = valueAtPath(item.request.body, jsonPath);
  } else if (location === "query") {
    try {
      const url = new URL(item.request.path, suite.baseUrl ?? "http://test.invalid");
      const values = url.searchParams.getAll(name!);
      candidate = parseScalar(values.at(-1), requirement.value);
    } catch { return false; }
  } else if (location === "header") {
    const entry = Object.entries(item.request.headers ?? {}).find(([key]) => key.toLowerCase() === name!.toLowerCase());
    candidate = parseScalar(entry?.[1], requirement.value);
  } else if (location === "cookie") {
    const cookieHeader = Object.entries(item.request.headers ?? {}).find(([key]) => key.toLowerCase() === "cookie")?.[1];
    const cookie = cookieHeader?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
    candidate = parseScalar(cookie?.slice(name!.length + 1), requirement.value);
  } else {
    const route = operationKey.slice(operationKey.indexOf(" ") + 1);
    const names = [...route.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!);
    const match = matchOperationPath(suite, item.request.path, route);
    const index = names.indexOf(name!);
    if (match && index >= 0) {
      try { candidate = parseScalar(decodeURIComponent(match[index + 1]!), requirement.value); }
      catch { return false; }
    }
  }
  return sameScalar(candidate, requirement.value);
}

function matchOperationPath(suite: ApiTestSuite, requestPath: string, route: string): RegExpMatchArray | undefined {
  const actual = relativeRequestPath(suite, requestPath).split("?", 1)[0] ?? "";
  const matcher = new RegExp(`^${escapeRegex(route).replace(/\\\{[^}]+\\\}/g, "([^/]+)")}$`);
  return actual.match(matcher) ?? undefined;
}

function relativeRequestPath(suite: ApiTestSuite, requestPath: string): string {
  let pathname: string;
  try { pathname = new URL(requestPath, suite.baseUrl ?? "http://test.invalid").pathname; }
  catch { return requestPath.split("?", 1)[0] ?? ""; }
  if (!suite.baseUrl) return pathname;
  try {
    let prefix = new URL(suite.baseUrl).pathname;
    if (!prefix.endsWith("/")) prefix += "/";
    if (pathname.startsWith(prefix)) pathname = `/${pathname.slice(prefix.length)}`;
  } catch { /* base URL was validated by the suite parser */ }
  return pathname;
}

function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function parseScalar(value: string | undefined, expected: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof expected === "boolean") return value === "true" ? true : value === "false" ? false : value;
  if (typeof expected === "number" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value;
}

function makeRequirement(operationKey: string, label: string, locator: OpenApiBoundaryRequirement["locator"], value: unknown, expectedStatus: "success" | "error", suffix: string): OpenApiBoundaryRequirement {
  return { id: `${operationKey}:${locator.in}:${locator.name ?? locator.jsonPath?.join(".") ?? "body"}:${suffix}`.slice(0, 240), label: label.slice(0, 400), locator, value, expectedStatus };
}
function sameScalar(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return typeof a === typeof b && a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameScalar(item, b[index]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const aKeys = Object.keys(a).sort(); const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index] && sameScalar(a[key], b[key]));
}
function isBoundaryScalar(value: unknown): value is string | number | boolean | null { return value === null || ["string", "number", "boolean"].includes(typeof value); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function isSimpleArrayItem(schema: unknown): boolean { return schema === undefined || (isRecord(schema) && ["string", "integer", "number", "boolean"].includes(schema.type) && Object.keys(schema).every(key => key === "type")); }
function sampleScalarArrayItem(schema: unknown): { supported: boolean; value: unknown } {
  if (schema === undefined) return { supported: true, value: null };
  if (!isRecord(schema) || !isSimpleArrayItem(schema)) return { supported: false, value: undefined };
  if (Array.isArray(schema.enum) && schema.enum.length) return { supported: isBoundaryScalar(schema.enum[0]), value: schema.enum[0] };
  if (schema.type === "string") return { supported: true, value: "a".repeat(Math.min(500, Math.max(0, Number(schema.minLength) || 0))) };
  if (schema.type === "boolean") return { supported: true, value: false };
  if (schema.type === "integer" || schema.type === "number") return { supported: true, value: typeof schema.minimum === "number" ? schema.minimum : 0 };
  return { supported: false, value: undefined };
}
