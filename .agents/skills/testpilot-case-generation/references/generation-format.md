# Case generation output and boundaries

The standalone generator emits a JSON object with:

- `requirements`: stable requirement IDs, source, priority, confidence, and `scopeStatus` (`in-scope`, `out-of-scope`, `deferred`, or `uncertain`). Mixed current/future statements are kept uncertain until split/reviewed.
- `cases`: preserved `existing` cases and separate `ai-draft` cases. Each contains requirement links, source references, scenario type, priority, preconditions, test-data descriptions, human-readable actions, expected result, confidence, and clarification items.
- `coverageMatrix`: one row per requirement, with scope status, AI case IDs, AI coverage status, and separate reference-set coverage IDs/status.
- `quality`: structural completeness, second-pass semantic review dimensions (actionability, observable expected result, grounding, atomicity, fixture readiness), scope-aware coverage counts, duplicate count within the AI batch, untraced AI case IDs, clarification count, and a held-out `benchmarkComparison`.
- To reserve room for coverage repair, the first generation pass uses 70% of the selected case cap. A follow-up pass targets in-scope requirements still missing AI cases; unmet items remain explicit when the cap or model response prevents completion. The default cap is 80.
- Baseline comparison and case-quality review run in batches of ten so a long JSON response does not invalidate the entire review. Failed batches are marked for manual review; the generation result remains available.
- `coverageMatrix.referenceStatus` is inferred from baseline comparisons of AI cases linked to that requirement. If no AI case is linked, reference coverage is uncertain; this is not a full independent remapping of all baseline cases to all requirements.
- The existing case set is excluded from the generation-model prompt. A separate post-generation evaluation labels each AI draft as duplicate, overlap, novel, or uncertain relative to the preserved baseline. This is a similarity/coverage comparison, not proof that either set is correct or complete.
- `aiDraftScore` checks structural completeness (requirement/source linkage, actionable steps, expected result, data or clarification, and scenario type). It is not a semantic correctness score. The semantic review is an AI second-pass review signal, not an oracle; report its dimensions and issues instead of presenting one score as a pass verdict.
- `sources` and `warnings`: input provenance and limitations.

The generator can parse PDF, XMind, Markdown, and TXT attachments. XMind case inventories are treated as held-out evaluation baselines and are never used as the generation prompt when parsed as cases. It attempts a bounded, unauthenticated read of a public static HTTP(S) page. It does not reuse browser cookies, sign in, or render JavaScript applications. Paste the relevant visible website text for authenticated or JavaScript-rendered pages. Public search results are inspiration only.

Do not add browser locators, runner DSL, scripts, execution calls, or pass/fail results in this phase.
