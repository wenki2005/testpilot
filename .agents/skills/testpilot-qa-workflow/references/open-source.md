# Open-source references for TestPilot QA

Use these projects as references or optional adapters. Keep TestPilot's review, target-origin, mutation, and evidence gates in front of any tool that can control a browser or send API requests.

## Verified project landscape (2026-10-18)

These repositories were checked against their GitHub README/license pages on the date above. The capability notes are the projects' own published descriptions, not a claim that TestPilot has integrated them.

| Project | License | Published capability relevant to TestPilot | Reuse decision |
|---|---|---|---|
| [AI Web](https://github.com/dongxinsuperman/ai-web) (Chinese-language project) | MIT, per repository | Browser-agent dispatch, browser agents, task queue/cancellation, step records, HTML reports, webhooks, materials, and multiple model adapters. Its README says it does not maintain a requirements/case library or manual testing workflow; reliability features such as substeps and safe replay are still on its roadmap. | Closest Chinese-language product reference for task orchestration and traceable execution. Borrow workflow ideas only; do not replace TestPilot's case inventory, approved DSL, or report semantics with natural-language tasks. |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | Apache-2.0, per repository LICENSE | Browser interaction over MCP; persistent profiles, isolated contexts, or extension connection to an existing browser/session. A persistent profile is single-instance at a time. | Reuse as a session-attachment reference. Do not run a second controller against the TestPilot-owned page; doing so can bypass its DSL, request guard, review, and evidence ownership. |
| [Stagehand](https://github.com/browserbase/stagehand) | MIT, per repository LICENSE | Playwright-based agent SDK with natural-language `act`/`observe`/`extract` primitives, persistent local browser options, and self-healing actions. | Potential isolated benchmark for locator resilience. Do not add as a second production executor before a comparative benchmark and an explicit session/safety boundary. |
| [Schemathesis](https://github.com/schemathesis/schemathesis) | MIT, per repository package metadata | Property-based API testing from OpenAPI/GraphQL, including positive/negative data generation, checks, and stateful operation sequences. | Best optional API adapter candidate when an authoritative contract, isolated environment, identity, fixtures, and cleanup exist. TestPilot already has an OpenAPI suite runner; first compare its coverage against Schemathesis rather than duplicating schema parsing or blindly fuzzing production. |
| [ServiceNow BrowserGym](https://github.com/ServiceNow/BrowserGym) | Apache-2.0, per repository LICENSE | Gym-style environment and benchmarks for web-agent research, including WebArena, WorkArena, MiniWoB and related suites. | Use to evaluate TestPilot's agent behavior on controlled benchmark tasks; it is a research environment, not a document-driven regression product. |

**Chinese search finding:** AI Web is a relevant Chinese-language open repository, but its stated scope is natural-language browser-agent dispatch and execution; it explicitly does not provide a requirements/case library or human QA workflow. It is therefore a source of orchestration/reporting patterns, not a drop-in replacement. **English search finding:** Playwright MCP, Stagehand, Schemathesis, and BrowserGym each cover a narrower underlying capability that TestPilot can call or benchmark without adopting another all-in-one agent framework.

No upstream code or skill was copied into this project in this review. References above link to repositories and their current license declarations; re-check the exact revision and dependency licenses before vendoring code or packaging a third-party runtime.

## Browser automation and session reuse

- Microsoft [Playwright CLI](https://github.com/microsoft/playwright-cli) and its [official browser skill](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md) provide concise browser operations and agent-facing guidance. Adapt only the relevant session, locator, trace, and test-generation workflows; the upstream skill can grant broad command permissions that do not match TestPilot's constrained BrowserStep DSL.
- Microsoft [Playwright MCP](https://github.com/microsoft/playwright-mcp) documents persistent profiles, isolated sessions, storage-state setup, and extension/CDP access to an existing authenticated browser. Use the persistent TestPilot page or explicit local CDP configuration to prevent repeated sign-in. Do not enable arbitrary upstream browser tools without preserving TestPilot's action and network policy.
- [Stagehand](https://github.com/browserbase/stagehand) (MIT) is a possible isolated browser-agent benchmark because it combines Playwright with natural-language actions and cached operations. It is not required for the current workflow and must not become a second unreviewed runtime. Compare it against the current deterministic + Computer Use lanes before considering integration.

## API contract testing

- [Schemathesis](https://github.com/schemathesis/schemathesis) (MIT) can generate reproducible property-based cases from OpenAPI or GraphQL schemas and check observed responses. Consider it as an optional API fuzz/provider only after the target publishes a contract and TestPilot has a dedicated staging allowlist, request limits, run-specific fixtures, cleanup checks, and explicit mutation approval.
- TestPilot already includes an OpenAPI-aware API suite adapter and deterministic runner. Reuse that implementation for approved contract suites; do not fabricate endpoint paths from business prose, and do not send mutating/fuzz traffic to the production sample-apply URL.

## Evidence and agent evaluation

- Playwright [Trace Viewer](https://playwright.dev/docs/trace-viewer-intro) is the preferred next evidence format for browser failures because it can capture actions and page/network state in a replayable trace. Gate trace creation and distribution because traces can contain DOM text, screenshots, and request data.
- [BrowserGym](https://github.com/ServiceNow/BrowserGym) is a research benchmark for evaluating web agents, not a customer-website test runner. Use it to assess TestPilot's agent behavior separately from product regression runs.
- Keep the current Pi Agent Core framework unless a benchmark shows a concrete gap. Adding Stagehand, BrowserGym, or another planning framework does not itself create executable coverage or resolve missing fixtures/API contracts.

Check each upstream project's current license and compatibility before copying code or adding a runtime dependency. Prefer linking to official packages and documenting the exact reused capability over vendoring large source trees.
