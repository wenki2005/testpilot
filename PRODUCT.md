# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

QA and software developers, plus business users who need to verify an application against requirements without writing browser automation themselves.

## Product Purpose

TestPilot helps people check web applications and local projects against requirements, investigate defects, and keep reusable regression tests. A successful session makes the target and scope clear, shows what was checked, and leaves reviewable evidence and reusable scripts when the run is complete.

## Positioning

TestPilot combines deterministic, reusable test scripts with an independent AI Computer Use run, compares their per-case results, and exposes differences for review before producing a final report and script package.

## Operating Context

Users can provide a web URL or choose a local project. Requirement documents and notes are optional context. Applications may require an interactive sign-in; the user completes authentication, and the test agent resumes only after an authorized browser session is available.

## Capabilities and Constraints

- Supports requirement-driven test-case drafting, reusable deterministic browser scripts, independent AI visual/browser checks, per-case comparison, reports, and script packages.
- An application may contain complex workflows; testing is not limited to simple static pages.
- AI-generated requirements, cases, and steps remain reviewable drafts until approved.
- External side effects such as submitting orders, deleting data, payments, or sending messages must be blocked unless a specific safe test strategy is explicitly configured.
- Authentication is completed by the user; the agent must not collect or enter credentials.
- A blocked test is not a product failure or a pass.

## Evidence on Hand

- Existing local TestPilot implementation and demonstration workflows in this repository.
- User-provided requirements and test materials are supplied per project; no public customer claims, benchmark results, or brand assets are established.

## Product Principles

- Put the target and task in one clear starting point.
- Keep optional context optional.
- Pair repeatable checks with independent AI observation.
- Show evidence and uncertainty; distinguish failures from blocked tests.
- Keep the user in control of review, sign-in, and consequential actions.
