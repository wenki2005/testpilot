import { parseDocument } from "yaml";
import { Validator } from "@platformatic/openapi-schema-validator";
import { extractOpenApiBoundaryRequirements, openApiRequiresManualBoundaryReview } from "../storage/openapi-boundary.js";

export type OpenApiSummary = {
  version: string;
  title?: string;
  operationCount: number;
  operations: Array<Record<string, unknown>>;
  securitySchemes: Record<string, unknown>;
  globalSecurity: unknown[];
};

export function openApiOperationFacts(summary: OpenApiSummary) {
  return summary.operations.map(operation => {
    const key = `${String(operation.method)} ${String(operation.path)}`;
    const body = operation.requestBody as Record<string, any> | undefined;
    const schemas = [
      ...((operation.parameters as Array<Record<string, any>> | undefined ?? []).map(parameter => parameter.schema)),
      ...Object.values(body?.content ?? {}).map((media: any) => media?.schema),
    ];
    return {
      key,
      declaredStatuses: ((operation.responses as Array<{ status: string }> | undefined) ?? []).map(response => response.status),
      securityRequired: Array.isArray(operation.security) && operation.security.length > 0,
      hasBoundaryConstraints: schemas.some(hasBoundaryConstraint),
      boundaryRequirements: extractOpenApiBoundaryRequirements(operation, summary.version),
      requiresManualBoundaryReview: openApiRequiresManualBoundaryReview(operation),
    };
  });
}

function hasBoundaryConstraint(value: unknown, depth = 0): boolean {
  if (!record(value) || depth > 8) return false;
  if (["enum", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern"].some(key => Object.hasOwn(value, key))) return true;
  return Object.values(value).some(child => Array.isArray(child)
    ? child.some(item => hasBoundaryConstraint(item, depth + 1))
    : hasBoundaryConstraint(child, depth + 1));
}

const methods = new Set(["get", "head", "options", "post", "put", "patch", "delete"]);

/** Parse a bounded OpenAPI 3 document into a compact, data-only operation index.
 * Only in-document JSON Pointer references are resolved; network refs and servers are never followed.
 */
export async function summarizeOpenApiSpecification(source: string): Promise<OpenApiSummary | undefined> {
  const text = source.trim();
  if (!text) return undefined;
  let root: unknown;
  try {
    if (text.startsWith("{") || text.startsWith("[")) root = JSON.parse(text);
    else {
      const document = parseDocument(text, { uniqueKeys: true });
      if (document.errors.length) throw new Error(document.errors.map(error => error.message).join("; "));
      root = document.toJS({ maxAliasCount: 20 });
    }
  } catch (error) {
    throw new Error(`OpenAPI JSON/YAML 无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!record(root)) throw new Error("OpenAPI 根节点必须是对象。");
  const version = typeof root.openapi === "string" ? root.openapi : "";
  if (!/^3\.[01](?:\.\d+)?$/.test(version)) throw new Error("当前只接受 OpenAPI 3.0/3.1 文档；Swagger 2.0 或非 OpenAPI 文本不能作为契约解析。");
  assertNoExternalRefs(root);
  const validator = new Validator({ strict: false, allErrors: true });
  const validation = await validator.validate(root);
  if (!validation.valid) {
    const errors = typeof validation.errors === "string" ? validation.errors : JSON.stringify(validation.errors ?? []);
    throw new Error(`OpenAPI 3 schema 校验失败：${errors.slice(0, 4000)}`);
  }
  if (!record(root.paths)) throw new Error("OpenAPI 文档缺少 paths 对象。");
  const pathEntries = Object.entries(root.paths);
  if (pathEntries.length > 300) throw new Error("OpenAPI 文档包含超过 300 个路径；请拆分后再生成测试。");
  const operations: Array<Record<string, unknown>> = [];
  for (const [path, pathItem] of pathEntries) {
    if (!path.startsWith("/")) continue;
    const resolvedPathItem = resolveDirectRef(pathItem, root, new Set());
    if (!record(resolvedPathItem)) continue;
    for (const [method, rawValue] of Object.entries(resolvedPathItem)) {
      const value = resolveDirectRef(rawValue, root, new Set());
      if (!methods.has(method.toLowerCase()) || !record(value)) continue;
      const params = [...(Array.isArray(resolvedPathItem.parameters) ? resolvedPathItem.parameters : []), ...(Array.isArray(value.parameters) ? value.parameters : [])]
        .slice(0, 40).map(parameterValue => resolveDirectRef(parameterValue, root, new Set())).filter(record).map(parameter => ({
          name: clip(parameter.name, 120), in: clip(parameter.in, 30), required: parameter.required === true,
          description: clip(parameter.description, 500), schema: compactSchema(parameter.schema, root),
          ...(Object.hasOwn(parameter, "example") ? { example: compactValue(parameter.example) } : {}),
        }));
      const resolvedRequestBody = value.requestBody === undefined ? undefined : resolveDirectRef(value.requestBody, root, new Set());
      const requestBody = record(resolvedRequestBody) ? {
        required: resolvedRequestBody.required === true,
        description: clip(resolvedRequestBody.description, 500),
        content: compactContent(resolvedRequestBody.content, root),
      } : undefined;
      const responses = record(value.responses) ? Object.entries(value.responses).slice(0, 30).map(([status, rawResponse]) => {
        const response = resolveDirectRef(rawResponse, root, new Set());
        return {
        status, description: record(response) ? clip(response.description, 500) : "",
        content: record(response) ? compactContent(response.content, root) : {},
      }; }) : [];
      operations.push({
        method: method.toUpperCase(), path: path.slice(0, 500), operationId: clip(value.operationId, 160),
        summary: clip(value.summary, 500), description: clip(value.description, 1200),
        parameters: params, ...(requestBody ? { requestBody } : {}), responses,
        security: Array.isArray(value.security) ? value.security.slice(0, 10) : (Array.isArray(root.security) ? root.security.slice(0, 10) : []),
      });
      if (operations.length >= 600) throw new Error("OpenAPI 文档包含超过 600 个操作；请拆分后再生成测试。");
    }
  }
  if (!operations.length) throw new Error("OpenAPI 文档没有可识别的 HTTP 操作。");
  const schemes = record(root.components) && record(root.components.securitySchemes) ? root.components.securitySchemes : {};
  return {
    version,
    ...(record(root.info) && typeof root.info.title === "string" ? { title: root.info.title.slice(0, 300) } : {}),
    operationCount: operations.length,
    operations,
    securitySchemes: Object.fromEntries(Object.entries(schemes).slice(0, 30).map(([name, scheme]) => [name, compactSecurityScheme(resolveDirectRef(scheme, root, new Set()))])),
    globalSecurity: Array.isArray(root.security) ? root.security.slice(0, 10) : [],
  };
}

function assertNoExternalRefs(root: Record<string, any>): void {
  const pending: unknown[] = [root];
  const visited = new WeakSet<object>();
  let nodes = 0;
  while (pending.length) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    if (++nodes > 100_000) throw new Error("OpenAPI 文档节点数超过安全解析上限。");
    visited.add(value);
    const ref = !Array.isArray(value) ? (value as Record<string, unknown>).$ref : undefined;
    if (typeof ref === "string" && !ref.startsWith("#/")) {
      throw new Error(`仅支持文档内 JSON Pointer 引用；拒绝 ${ref.slice(0, 200)}。`);
    }
    for (const child of Object.values(value)) pending.push(child);
  }
}

function compactContent(value: unknown, root: Record<string, any>): Record<string, unknown> {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([mediaType, media]) => [mediaType.slice(0, 120), record(media) ? {
    schema: compactSchema(media.schema, root), ...(Object.hasOwn(media, "example") ? { example: compactValue(media.example) } : {}),
  } : {}]));
}
function compactSchema(value: unknown, root: Record<string, any>, depth = 0, refStack = new Set<string>()): unknown {
  if (record(value) && typeof value.$ref === "string") {
    const ref = value.$ref;
    if (refStack.has(ref)) return { $ref: ref };
    const resolved = resolveDirectRef(value, root, refStack);
    const nextStack = new Set(refStack).add(ref);
    return compactSchema(resolved, root, depth, nextStack);
  }
  if (!record(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of ["$ref", "type", "format", "description", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "nullable", "additionalProperties"]) {
    if (Object.hasOwn(value, key) && (typeof value[key] !== "object" || key === "additionalProperties")) result[key] = compactValue(value[key]);
  }
  for (const key of ["enum", "required"]) if (Array.isArray(value[key])) result[key] = value[key].slice(0, 30).map(compactValue);
  if (Object.hasOwn(value, "default")) result.default = compactValue(value.default);
  if (Object.hasOwn(value, "example")) result.example = compactValue(value.example);
  if (depth < 3) {
    if (record(value.properties)) result.properties = Object.fromEntries(Object.entries(value.properties).slice(0, 30).map(([key, item]) => [key.slice(0, 120), compactSchema(item, root, depth + 1, refStack)]));
    if (record(value.items)) result.items = compactSchema(value.items, root, depth + 1, refStack);
    for (const key of ["oneOf", "anyOf", "allOf"]) if (Array.isArray(value[key])) result[key] = value[key].slice(0, 8).map(item => compactSchema(item, root, depth + 1, refStack));
  }
  return result;
}
function resolveDirectRef(value: unknown, root: Record<string, any>, stack: Set<string>): unknown {
  if (!record(value) || typeof value.$ref !== "string") return value;
  const ref = value.$ref;
  if (!ref.startsWith("#/")) throw new Error(`Only local OpenAPI JSON Pointer refs are supported; rejected ${ref.slice(0, 200)}.`);
  if (stack.has(ref)) throw new Error(`Cyclic non-schema OpenAPI reference: ${ref}.`);
  let pointer: string[];
  try { pointer = ref.slice(2).split("/").map(part => decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~")); }
  catch { throw new Error(`Malformed local OpenAPI reference: ${ref.slice(0, 200)}.`); }
  let target: unknown = root;
  for (const part of pointer) {
    if (!record(target) || !Object.hasOwn(target, part)) throw new Error(`Unresolved local OpenAPI reference: ${ref}.`);
    target = target[part];
  }
  if (!record(target)) throw new Error(`OpenAPI reference must point to an object: ${ref}.`);
  const nextStack = new Set(stack).add(ref);
  const resolved = resolveDirectRef(target, root, nextStack);
  if (!record(resolved)) throw new Error(`OpenAPI reference did not resolve to an object: ${ref}.`);
  const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
  return { ...resolved, ...siblings };
}
function compactSecurityScheme(value: unknown): unknown {
  if (!record(value)) return {};
  const result: Record<string, unknown> = {};
  for (const key of ["type", "description", "name", "in", "scheme", "bearerFormat", "openIdConnectUrl"]) if (typeof value[key] === "string") result[key] = (value[key] as string).slice(0, 500);
  if (record(value.flows)) result.flows = Object.keys(value.flows).slice(0, 8);
  return result;
}
function compactValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 30).map(compactValue);
  if (record(value)) return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key.slice(0, 120), compactValue(item)]));
  return value;
}
function clip(value: unknown, max: number): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined; }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
