# API Contract lane: intake and mapping plan

Date: 2026-10-18  
Document project: `624a5e81-e79e-493f-a746-8accc5c44b90`  
Source inventory: `部门申样书_V1.0_测试用例.xmind` (156 cases)

## Current verified state

- The project contains 156 cases, of which 58 are routed to `api-contract`.
- There is no API suite artifact associated with this project and no approved suite to map. The API mapping panel correctly reports that no approved suite is available. This is why the API lane has no executable API cases; it is not evidence that the service endpoint failed.
- An API suite and a document-case mapping are separate prerequisites. The API suite must first be authored from the real contract and approved; then cases can be linked explicitly. A mapping must not be inferred from a business title and silently treated as reviewed.
- The document orchestrator previously rejected every suite containing fixtures, role matrices or concurrency even though the approved API runner supported those features. This integration gap has now been repaired: the document lane delegates the whole suite and fixture lifecycle to the existing API runner and passes three independent project authorizations. The UI candidate mapping stays unselected until a person checks it.
- This code repair does not change the historical 156-case run or claim these 58 cases were verified. No real contract, sandbox, credentials, roles or fixture data were available, so a new live API run remains unperformed and correctly blocked until the owner supplies those inputs.
- This audit did not send requests to the application or its integrations, approve a suite, or use the shared Edge session.

## What to provide to make the lane executable

Provide the following through the TestPilot API suite form (OpenAPI can be pasted or uploaded) or the equivalent MCP prepare flow:

1. **Real OpenAPI 3.0/3.1 JSON or YAML** for the target service, including request/response schemas, documented status codes, security declarations, and path-parameter examples/defaults where applicable. Do not derive endpoint paths from case prose.
2. **Isolated test base URL** for a staging/sandbox service. The base URL must not include credentials, query parameters, or fragments. Confirm that it is authorized for this test run.
3. **Authentication variable names and local values**: put secret values in the TestPilot process environment (for example in the local `.env`, which is not to be shared), then reference them in the suite as `${ENV:VARIABLE_NAME}`. Do not paste real tokens/passwords into the suite, case text, or report.
4. **Role identities** available in that environment (applicant, manager/approver, order administrator, ordinary user, etc.) and which credential variable belongs to each principal.
5. **Test-data contract**: seeded record identifiers or a fixture factory; expected initial state; and a cleanup operation that can proveably target only this run's records. For write operations the current runner requires `${RUN_ID}` in the request/setup data and a cleanup suite that targets the same run ID.
6. **Integration behavior available in sandbox**: whether WeCom, Wangdiantong, Yichengtong, logistics and scheduled jobs are stubbed, deterministic, or live; the supported way to seed callbacks, simulate failures and advance the 72-hour/10-minute clock. Do not invoke real third-party side effects as test fixtures.
7. **Approval policy** for the candidate suite and explicit authorization for network access, writes, or concurrency if those are needed. These are independent gates; approval alone does not enable them. The document API lane forwards each separate authorization to the existing approved API runner; all three remain off by default.

## Candidate mapping inventory (not approved)

These groups are based only on the XMind requirement text. They identify contract capability families to look for after the actual OpenAPI contract arrives; they are **not endpoint names, approved mappings, or proof that an operation exists**. A candidate becomes mappable only when a real `METHOD /path` in the supplied contract and the suite assertion cover the requirement.

| Candidate capability family | Document case IDs | Contract / fixture evidence needed |
|---|---|---|
| Request validation, product lookup, and form-related server checks | `case-27`, `case-34`, `case-39`, `case-42`, `case-51`, `case-65`, `case-74`, `case-132`, `case-134`, `case-135`, `case-137`, `case-139`, `case-140`, `case-141`, `case-142`, `case-143`, `case-144`, `case-145` | Actual submission/lookup operation; request schema and validation response schema/status; product lookup fixture. UI-only assertions remain in the browser lane and should not be represented as API coverage.
| Customer lookup, approvals, order creation, stock locking, and outbound integrations | `case-6`, `case-7`, `case-9`, `case-11`, `case-12`, `case-14`, `case-38`, `case-68`, `case-100`, `case-115`, `case-116`, `case-117`, `case-119`, `case-121`, `case-122`, `case-123`, `case-124`, `case-125` | Real contract operations plus sandbox integration stubs/fixtures, approval status transitions, failure injection and cleanup. No real approval, shipping, inventory lock or notification should be triggered.
| Order detail, query/filter, logistics and time-based state | `case-85`, `case-86`, `case-101`, `case-106`, `case-107`, `case-126`, `case-127`, `case-154` | Read endpoint schema, seeded orders in each state, controlled clock/job trigger, refresh evidence and status mapping. Wall-clock waiting is not a substitute for a deterministic clock fixture.
| Identity, access control, and deep-link authorization | `case-99`, `case-114`, `case-149`, `case-150`, `case-151`, `case-152` | Authentication flow/contract, at least two isolated principals, ownership fixtures, expected 401/403 behavior and safe deep-link setup. The user-facing H5 QR session alone cannot establish these API assertions.
| Data migration and environment configuration | `case-109`, `case-113`, `case-128`, `case-129`, `case-130` | Migration source/target snapshots, rollback/restore procedure, configuration source and non-production values. Some checks may need a dedicated migration or source/config lane rather than an HTTP API case.
| Transaction, callback idempotency, and race handling | `case-146`, `case-147`, `case-148` | Isolated callback/job test harness, deterministic injected failures, concurrency policy, transaction readback and cleanup. A live WeCom callback or production compensation job is not an acceptable test fixture.

The six groups reconcile to exactly 58 API-routed source cases. Some cases may map to more than one API case (for example success plus authorization/error variants); mapping is explicit and reviewable. Cases with only a visible UI expectation should keep their browser assertion even if a related API check is added.

## Execution sequence after the inputs arrive

1. Validate the OpenAPI document locally through the API suite authoring flow. Use only the supplied isolated base URL; ignore the contract's `servers` value as a target.
2. Draft API scenarios with exact `source` and `requirementRefs` linking back to the case IDs above. Start with read-only operations. Use exact documented response status/schema assertions; add boundary cases only where request examples and expected rejection behavior are grounded.
3. Define principals and `${ENV:...}` credential references. Add setup/cleanup only for sandbox data and use `${RUN_ID}` for every mutating flow. If a cleanup cannot safely identify run-created data, keep that flow blocked. The existing API runner owns the entire fixture lifecycle; the document lane does not issue its own fixture traffic.
4. Review the suite content, target origin, network/write/concurrency switches and fixtures. Do not approve a draft automatically. Approval locks its digest.
5. Build explicit document-case → API-case candidate mappings. Review each suggestion against its OpenAPI operation and expected result; saving the mapping does not approve the API suite or grant network/write permission.
6. Run the approved API suite in the isolated environment. The document-run defaults are `allowNetwork=false`, `allowMutations=false`, and `allowConcurrency=false`; the user must separately enable any required capability in the project's API panel, which resets project review to draft. Inspect each result, fixture cleanup and evidence. A failed fixture setup blocks test requests; failed setup/cleanup cannot be hidden behind passing mapped cases. Compare API findings with the corresponding browser case; disagreement triggers investigation, not averaging.
7. Export the API report/package and the document dual-lane report/package. Keep API-only evidence distinct from browser/Computer Use evidence.

## Remaining limits

OpenAPI operation coverage counts show trace links, not semantic completeness. The API runner validates only the authored request method/path, status, headers, JSON assertions and supported boundaries. It attempts cleanup but cannot independently prove that all remote side effects were removed. It cannot prove third-party behavior unless that system is represented by an authorized deterministic sandbox. The XMind includes migration, source/configuration, scheduler, identity and cross-system requirements that may require dedicated fixtures or additional adapters even after an OpenAPI file is supplied.
