import type { BrowserCheck } from "../../../domain/documents/shared/test-model.js";
import { planCaseExecution } from "../../../domain/documents/cases/case-routing.js";
import type { DocumentApiLane } from "../../../domain/documents/shared/test-contracts.js";

/** Coordinates the API portion of a document run while keeping suite discovery and execution injectable. */
export async function executeDocumentRunApiLane(input: {
  selectedCases: BrowserCheck[];
  signal: AbortSignal;
  execute: (routedCases: BrowserCheck[], signal: AbortSignal) => Promise<DocumentApiLane>;
}): Promise<{ routedCases: BrowserCheck[]; lane?: DocumentApiLane }> {
  const routedCases = input.selectedCases.filter(item => planCaseExecution(item).route === "api-contract");
  if (!routedCases.length) return { routedCases };

  const lane: DocumentApiLane = input.signal.aborted
    ? {
      status: "cancelled",
      summary: "API contract 用例尚未开始或未完成。",
      provider: "TestPilot approved API runner",
      results: routedCases.map(item => ({ id: item.id, title: item.title, status: "not-run", detail: "运行被手动停止；此 API 用例尚未执行。", apiCaseResults: [] })),
    }
    : await input.execute(routedCases, input.signal);
  return { routedCases, lane };
}
