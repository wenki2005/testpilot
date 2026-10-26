# TestPilot blocker recovery

Use this reference whenever a selected case is blocked, has empty steps, or cannot be verified by one of its required lanes. The purpose is to remove avoidable blockers and make unavoidable ones actionable. A blocked status alone is not a diagnosis or a completed investigation.

## 1. Start from the case and run evidence

For each stable source case ID, read the original requirement, current approved case revision, lane outcomes, screenshots/traces, run warnings, and any previous retest. Record the exact failed operation or absent evidence. Do not infer a cause from the word `blocked` alone. Preserve the source case and create a traceable revised draft for edits.

Classify the immediate cause as one of:

- **TestPilot defect**: incorrect classification, locator alias, serialization, retry, evidence parsing, orchestration order, or report/package omission. Reproduce it, fix the implementation and regression coverage, then rerun the affected case. Do not leave the user with a workaround instruction when the runner itself is broken.
- **Incomplete case/script**: acceptance text is concrete but steps are empty, generic, or assert the wrong thing. Derive each check from the source; use the authenticated page to ground locators and expected UI evidence; add only supported DSL actions; validate and execute the draft.
- **Lane capability gap**: the expectation is clear but a runner action/assertion or model tool call is unavailable. Keep any other executable lane/subcheck, name the missing capability, and make a bounded implementation change when it is within TestPilot's architecture. Add a regression test and verify the exported runner/package too.
- **External prerequisite**: a specific role, record, fixture, contract, sandbox, cleanup procedure, or owner clarification is absent. State the exact artifact/data/approval needed and the next action/owner. Do not claim a generated fixture exists unless it was actually created in an approved isolated environment.
- **Environment/authentication**: distinguish expired session, wrong target, service failure, and absent permission from product behavior. Reuse the current managed browser session. A login wait is resumable; request one login action only if that same session is actually unauthenticated, then verify and resume it without creating a new browser/window.
- **Product failure**: the expected behavior is sufficiently specified, the needed preconditions exist, and evidence affirmatively contradicts the expectation. Keep the failure with its evidence; do not edit the expected result to make the case pass.
- **Ambiguity/scope**: the requirement itself does not establish the expected behavior or applicability. Preserve it and request an owner decision with the smallest precise question. Do not invent acceptance criteria.

## 2. Repair in this order

1. Check that the run reached the correct target and that its case revision was the reviewed revision.
2. Fix deterministic workflow/runner bugs first. If a generator was skipped, never ran on the authenticated target, or produced a valid step that the runner misclassified, correct that defect rather than classifying the affected case as an external blocker.
3. Author independently verifiable UI assertions even when the full requirement also needs an API/fixture check. Mark the subcheck coverage explicitly; a UI subcheck cannot satisfy backend, role, persistence, notification, or data-integrity acceptance points.
   When a clear case is routed to `browser-ui` but its full scenario needs a fixture, the visual lane may still perform bounded read-only discovery under the request guard. Preserve the uncovered fixture clause and keep the case blocked; do not let the gap suppress all useful UI evidence.
4. For API behavior, use the approved TestPilot API suite lifecycle and a real owner-supplied OpenAPI contract, base URL, identity, fixture, and cleanup. Map source IDs to API case IDs explicitly. If these are missing, prepare a prerequisite request and keep the API acceptance point blocked; do not guess endpoints/payloads, call an unverified production API, or interpret HTTP success alone as business success.
5. After a code or case fix, run focused regression for the affected case and every executable required lane, then rerun the complete approved selection when the user asked for a full suite. Preserve the original run and link retests with revision, reason, environment/reset evidence, and case IDs. Never retry mutations without a verified isolation/reset path.
6. Reconcile every case and lane before export. Report unresolved items with `reason`, `neededEvidenceOrFixture`, `safeNextAction`, `coveredAcceptancePoints`, and `uncoveredAcceptancePoints`. Keep counts by lane and by comparison; partial evidence must not become a whole-case pass.

## 3. Do not manufacture success

- `blocked`, `error`, missing result, skipped, and `not-applicable` are never `passed`.
- Matching failures are aligned product failures, not successful QA. A matching blocked result is still unverified.
- Do not count screenshot inspection, passive observation, page-load checks, script generation, or a ZIP file as execution of the business acceptance point.
- Do not turn absent records into product failures when the case requires seeded data; equally, do not silently mark such a case passed because a related screen loaded.
- Do not set whole-run readiness when any required in-scope acceptance point lacks evidence, even if the selected executable subset is aligned.
- A model outage or malformed response is a runner/model capability issue. Retry only within the bounded behavior already implemented and only when no action occurred; otherwise preserve evidence and fix the adapter or report the exact lane limitation.

## 4. Shared browser session rules

The TestPilot managed page is the single source of browser and login continuity for one project run. Check session status before asking for authentication. Reuse the same page through page-evidence collection, deterministic execution, visual execution, and case retests. The visual and deterministic lanes are sequential and share state; disclose possible state carry-over. Never launch a per-case browser or request repeated QR scans when the session remains authenticated. Do not interact with the shared page from a separate test while a run owns it.

## 5. MCP contract boundary

Use only tools actually exposed by the connected MCP server. The current website MCP lifecycle supports prepare, inspect, revise, approve, dual-lane run, inspect run, and export. It currently does not expose a dedicated website step-generation tool, login-resume tool, or case-targeted retest tool. Do not fabricate calls or imply those operations were performed through MCP. If a login handoff is waiting, use the existing TestPilot workbench/session continuation exposed to the user and then inspect the same run. For case changes or targeted retests not supported through MCP, use the workbench's existing reviewed workflow if available; otherwise document the missing operation for implementation and do not substitute an unrelated full rerun that repeats unsafe side effects.

After any MCP/workbench operation, inspect authoritative run/project records and exported artifacts. Tool acknowledgement only proves that a request was accepted; it does not prove cases executed or passed.
