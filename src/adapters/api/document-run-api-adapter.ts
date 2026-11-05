import { executeDocumentRunApiLane } from "../../application/runs/execution/api-lane-service.js";
import type { BrowserCheck, DocumentProject } from "../../domain/documents/shared/test-model.js";
import type { DocumentApiLane } from "../../domain/documents/shared/test-contracts.js";
import { planCaseExecution } from "../../domain/documents/cases/case-routing.js";
import { executeApprovedApiSuite, getApiSuiteCandidate } from "./suite-workflow.js";
import { executeDocumentApiLane } from "./document-lane.js";

/** Bridge frozen document-run cases to the reviewed API-suite runner. */
export async function dispatchDocumentRunApiLane(input: {
  project: Pick<DocumentProject, "apiContract" | "cases">;
  selectedCases: BrowserCheck[];
  signal: AbortSignal;
  getCandidate: typeof getApiSuiteCandidate;
  runApproved: typeof executeApprovedApiSuite;
}): Promise<{ routedCases: BrowserCheck[]; lane?: DocumentApiLane }> {
  return executeDocumentRunApiLane({
    selectedCases: input.selectedCases,
    signal: input.signal,
    execute: async (apiCases, signal) => {
      const candidate = input.project.apiContract?.suiteId
        ? await input.getCandidate(input.project.apiContract.suiteId)
        : undefined;
      const selectedApiCaseIds = new Set(apiCases.map(item => item.id));
      return executeDocumentApiLane({
        candidate,
        documentCases: input.project.cases
          .filter(item => planCaseExecution(item).route === "api-contract")
          .map(item => ({ id: item.id, title: item.title, selectedForRegression: selectedApiCaseIds.has(item.id) })),
        mapping: input.project.apiContract?.mappings ?? [],
        allowNetwork: input.project.apiContract?.allowNetwork === true,
        allowMutations: input.project.apiContract?.allowMutations === true,
        allowConcurrency: input.project.apiContract?.allowConcurrency === true,
        signal,
        runApproved: async (candidateId, options) => input.runApproved(candidateId, {
          allowNetwork: options.allowNetwork,
          allowMutations: options.allowMutations,
          allowConcurrency: options.allowConcurrency,
          caseIds: options.selectedCaseIds,
          scopeOnly: true,
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      });
    },
  });
}
