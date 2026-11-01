import { isDeepStrictEqual } from "node:util";
import type { ApiTestSuite } from "../storage/api-suite-loader.js";

/** Flag potentially incompatible expectations for review, without changing any assertion. */
export function conflictingReadOnlyExpectations(suite: ApiTestSuite, caseId: string): Array<{ caseId: string; expectedStatus: number }> {
  const readOnly = (method: string) => ["GET", "HEAD", "OPTIONS"].includes(method);
  // Stateful suites may deliberately read the same resource before and after a mutation.
  if (suite.fixtures || suite.cases.some(item => !readOnly(item.request.method))) return [];
  const selected = suite.cases.find(item => item.id === caseId);
  if (!selected || selected.accessControl) return [];
  const headers = (values: Record<string, string> | undefined) => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const sameRequest = suite.cases.filter(item => !item.accessControl
    && item.request.method === selected.request.method && item.request.path === selected.request.path
    && isDeepStrictEqual(headers(item.request.headers), headers(selected.request.headers))
    && isDeepStrictEqual(item.request.body, selected.request.body));
  if (new Set(sameRequest.map(item => item.expect.status)).size < 2) return [];
  return sameRequest.map(item => ({ caseId: item.id, expectedStatus: item.expect.status }));
}
