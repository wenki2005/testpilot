# TestPilot MCP full-lifecycle audit

Audit date: 2026-10-18. Scope: `src/mcp/server.ts`, the TestPilot QA skills, and the document-test orchestration contract. This is an implementation audit, not a claim that every source case is currently executable.

## Current MCP workflow

The stdio MCP server already exposes these document-test operations:

1. `testpilot_prepare_web_test` imports one optional PDF/XMind/Markdown/TXT document (base64, max 9 MB) plus a target URL or requirement text, creating a draft project.
2. `testpilot_get_web_test` reads the complete project/case inventory.
3. `testpilot_update_web_test_cases` saves edits and resets review to draft.
4. `testpilot_approve_web_test_cases` records approval.
5. `testpilot_run_web_dual_validation` starts deterministic Playwright plus visual Computer Use lanes.
6. `testpilot_get_web_run` reads the run, and `testpilot_export_web_run` returns a report and ZIP, including partial outcomes.

The API and SQLite migration workflows have separate candidate/review/run/export tools. They should remain separate lanes and keep their own contracts and safety gates.

## Requirement-to-capability matrix

| Desired behavior | Evidence in current implementation | Status / actionable gap |
|---|---|---|
| Import requirements and existing cases, preserve all IDs | `testpilot_prepare_web_test`; importer handles one document per call; get tool returns project cases | Partial. MCP has no multi-attachment/project append tool. Multiple documents require multiple projects/importer support; a single XMind with 156 leaf cases is supported. Require an inventory reconciliation before approval. |
| Research examples and trace sources | Project supports source text and `researchExamples` fields internally; MCP input has no research/search tool | Missing in MCP. Research must be a separately sourced, optional planning stage, with URL/title/date and attribution. Never pass web examples as authoritative product requirements. |
| Generate missing executable steps from target evidence | UI workflow has post-login generation and validates generated DSL; MCP update tool can save cases | Not a complete MCP capability. There is no MCP step-authoring tool; do not claim that calling `prepare` or `run` guarantees missing steps are generated. Expose the actual run warning and generated IDs, and ensure generation happens only after the existing project page has target/auth evidence. |
| Review cases and approve | `get`, `update`, `approve` tools; update invalidates approval | Implemented. Approval is a user decision; after editing, require a fresh review. |
| Deterministic + visual lane and comparison | `run_web_dual_validation`; run record stores both lane outcomes/comparisons | Implemented with limits. Both lanes use the same project page sequentially, so comparison is not independent corroboration. Preserve the lane-specific result and evidence. |
| Login handoff with one persistent browser window | Runtime has a persistent shared page/login handoff; run stage can be read through `get_web_run` | Runtime behavior exists, but MCP has no explicit `get_login_handoff` / `resume_after_login` operation. An MCP-only caller cannot reliably present/resume the UI handoff. Add a typed handoff status/continuation contract before advertising unattended MCP login flow. Never create a new page per case or ask for another QR after the existing handoff is acknowledged. |
| Compare, diagnose, retest only changed/unstable cases | Run read/export tools; there is no document-run targeted-retest MCP tool | Partial. Current MCP provides evidence review but no case-specific retest operation. Route through the workbench or add a retest tool that takes run ID, case IDs, reason, and reset/fixture evidence; retain lineage and approval digest. |
| Report and reusable package | `testpilot_export_web_run` returns Markdown + ZIP resource even for partial runs | Implemented, with correct partial label. Consumer must inspect `caseScope`, unresolved cases, and readiness; package existence does not mean full coverage. |
| Work across broader application types | Web, API contract, SQLite migration and local-project script families exist | Partial. Each family is a separate adapter; do not imply browser tests cover API persistence, authorization, concurrency, mobile, desktop, or arbitrary source code. |

## Recommended next MCP contract changes

1. Add `testpilot_get_web_run` fields that make `stage`, `awaitingLogin`, `loginHandoffId`, `stepGeneration.generatedCaseIds`, `stepGeneration.warning`, selected count and total count easy to read without parsing the raw run object.
2. Add a login handoff status/continue operation only if it binds to the already-open project page and current run ID. The operation must not create or close a browser/page. If the handoff is UI-only, state that explicitly and return the exact UI action/URL rather than suggesting the model can continue itself.
3. Add an explicit project append/import operation for multiple requirement files; preserve all source references and deduplicate only with visible, reviewable mappings. Keep imported cases in the complete inventory even when unselected.
4. Add targeted retest with immutable original run link, case IDs, correction/fixture reason, and digest. Require reset evidence for transient retry; require fresh review if case steps change.
5. Add an execution-plan/readiness tool that lists every case's lane, supported assertions, missing evidence, and the exact blocker before approval. It must not silently convert prerequisite gaps to generated success criteria.

These are proposed contract changes; none should be presented as existing tools until implemented and integration-tested.

## Reuse upstream projects instead of duplicating them

- **Playwright MCP**: [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) supports headed browsing, persistent profiles, and connecting an existing browser through its extension. Reuse its browser/session research and extension model when strengthening TestPilot's session attachment. Do not add a second MCP browser executor to the current workflow without a clear ownership boundary: it can bypass TestPilot's review, case DSL, request guard, and run evidence. Upstream docs explicitly note persistent profile reuse and single-instance ownership; test that against the current CDP session before adopting.
- **Playwright Test**: [Microsoft Playwright](https://github.com/microsoft/playwright) remains the deterministic browser engine. Keep TestPilot's bounded DSL and package reproducibility over this engine; don't replace the execution layer with an unrestricted CLI skill.
- **Schemathesis**: [Schemathesis](https://github.com/schemathesis/schemathesis) offers OpenAPI property-based testing and stateful operation sequences. Evaluate it as an optional API adapter when an authoritative OpenAPI contract, isolated target, and data cleanup are supplied. Its generated cases cannot be treated as satisfying document requirements unless traced and asserted explicitly.
- **MCP**: The current MCP workflow already uses the official TypeScript MCP server SDK (`@modelcontextprotocol/server`). Prefer extending these tools and their schemas over creating a parallel proprietary agent protocol.

## Skill alignment

`../.agents/skills/testpilot-qa-workflow/SKILL.md` already says to preserve complete inventory, author grounded subchecks, reuse the persistent browser page, run both lanes, compare by case ID, retest from evidence, and package honestly. The main risk is capability drift: skill language must not cause callers to assume MCP exposes a login-resume or targeted-retest tool. This audit records those gaps separately. Keep the workflow skill as the operating procedure and this file as the current MCP contract map; update both when code changes.

## Validation boundary

This audit was checked against the current source MCP tool schemas and document workflow integration coverage, including `tests/document-workflow.integration.test.mjs`, `tests/document-post-login-generation.integration.test.mjs`, and API MCP integration coverage. The existing tests establish mocked/local workflow behavior; they do not prove all 156 cases are executable against a real application or that arbitrary model gateways support visual tool calling.
