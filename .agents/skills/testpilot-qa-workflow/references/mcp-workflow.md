# TestPilot MCP reference

The MCP server uses the official TypeScript SDK and stdio transport. It is a thin local adapter over the TestPilot HTTP service; test execution and review validation remain in the service.

## Start and connect

Start the TestPilot demo service, then start the MCP process in the same project checkout. Set `TESTPILOT_BASE_URL` to the service's loopback URL (for example `http://127.0.0.1:4330`; the service's default port is `4317`). The MCP server rejects non-loopback endpoints.

From the repository root:

```powershell
$env:TESTPILOT_BASE_URL = 'http://127.0.0.1:4330'
npm run mcp
```

For an MCP host that launches the process, use `node` with arguments pointing to the checkout's `node_modules/tsx/dist/cli.mjs` and `src/mcp/server.ts`; set `TESTPILOT_BASE_URL` in that server entry's environment. Keep stdout reserved for MCP JSON-RPC; diagnostics belong on stderr.

## Website tools

| Stage | Tool | Gate / result |
|---|---|---|
| Check service | `testpilot_status` | Reads model availability and project summaries. |
| Prepare | `testpilot_prepare_web_test` | Imports or creates a draft from target URL, optional requirement text, and optional base64 PDF/XMind/Markdown/TXT. Returns project ID. |
| Inspect | `testpilot_get_web_test` | Returns source, cases, steps, and review state. |
| Revise | `testpilot_update_web_test_cases` | Replaces draft cases and resets review status to draft. The service validates step types and unsafe click names. |
| Draft steps | `testpilot_generate_web_test_steps` | Generates steps only for named case IDs from the existing authenticated page evidence. Writes a draft and requires the updated case plan to be reviewed before execution. |
| Scope | `testpilot_set_web_test_selection` | Adds/removes named cases from the regression selection without replacing the case inventory or losing step/coverage metadata. Keeps at least one case selected; a scope change follows the project's review policy and never starts a run. |
| Approve | `testpilot_approve_web_test_cases` | Records explicit approval; run endpoint rejects unapproved projects. |
| Execute | `testpilot_run_web_dual_validation` | Starts the selected cases in the background and immediately returns a stable `runId`. It does not wait for a long run in the MCP request. A repeated start for the same active project reuses its active run ID. |
| Poll | `testpilot_get_web_run_progress` | Reads the persisted stage, active case, per-lane results and progress by `runId`; this remains queryable through a service restart. Keep polling when `status` is `running` or `awaiting-login`. |
| Inspect run | `testpilot_get_web_run` | Reads terminal run details and `finalReady`; call after progress reports `completed`. |
| Deliver | `testpilot_export_web_run` | Returns Markdown and an embedded ZIP after a completed run. Partial/unresolved results remain explicitly labeled and must not be described as verified. |

`prepare` does not authenticate to the target. If the application displays a sign-in gate, the human user must sign in through the persistent project browser session before the agent resumes. `run` does not bypass the project's review state. `export` allows partial artifacts but labels unresolved or blocked differences; do not represent them as verified.

**Current website MCP boundary:** the MCP server exposes the case inventory and lifecycle above. Login continuation remains available through the workbench's existing login handoff; do not ask the user to scan again if the same managed session is still open. A requested focused retest can be performed by updating the selection to the chosen case IDs, reviewing the changed scope if required, starting a run, polling it, then restoring the intended full regression selection. A selection patch never runs tests by itself. See [blocker recovery](blocker-recovery.md) for the repair-first procedure and evidence requirements.

## API tools

| Stage | Tool | Gate / result |
|---|---|---|
| Prepare | `testpilot_prepare_api_test` | Accepts a version 1 JSON suite (up to 60 KB); the service validates it and saves a draft with a SHA-256 digest. It sends no target requests. |
| Inspect | `testpilot_get_api_test` | Returns suite content, fixtures, digest and review state. |
| Revise | `testpilot_update_api_test` | Edits only a draft, revalidates the suite, increments its revision, and computes a new digest. Approved/rejected versions are immutable. |
| Review | `testpilot_review_api_test` | Records explicit approve/reject; approved content is immutable. A revision needs a new candidate and approval. |
| Execute | `testpilot_run_approved_api_test` | Refuses drafts/rejected or digest-mismatched suites. Loopback, read-only requests are the default. Network, mutation and concurrency each need a separate explicit option. |
| Inspect run | `testpilot_get_api_run` | Returns status, per-case evidence and limitations. `blocked` does not mean pass or product failure. |
| Diagnose finding | `testpilot_diagnose_api_finding` | Reads the persistent finding and its latest run evidence. Returns deterministic classification and a recommendation only; it never calls a model, edits a suite, sends target traffic, or reruns. Any suggested targeted rerun must be explicitly started from the workbench. |
| Deliver | `testpilot_export_api_run` | Returns the Markdown report plus ZIP with `suite.json`, `README.md`, `run.json` and `report.md`; CLI reruns do not need an AI model. |

Mutating cases require setup/cleanup fixtures with per-run isolation placeholders. Even with cleanup fixtures, report that the runner cannot independently prove all side effects were removed. Keep API credentials in environment-variable references, never inline secrets in suite JSON.

### Recovering a document project's blocked API lane

Before treating a document case routed to `api-contract` as permanently blocked, inspect `/api/api-suites` and the project's `apiContract` configuration. If there is no approved suite or no mapping, make the missing input concrete: request the owner-supplied OpenAPI 3.0/3.1 document, an authorized isolated base URL, local environment-variable credentials, required principals, deterministic test fixtures, and safe cleanup/clock/integration controls. Do not turn business prose into guessed HTTP paths.

After a real suite exists, the document mapping panel can surface textual similarity candidates. These are review hints only: inspect the actual `METHOD /path`, source requirement, status/body assertion, role and fixture coverage. Candidate display must not check a box, persist a mapping, approve a suite, enable external network access, or enable mutations. A UI assertion may remain mapped to the browser lane while a separate API case verifies its backend counterpart. If no OpenAPI operation actually supports a requirement, keep that requirement blocked and name the absent contract/fixture rather than forcing a nearest-title match. In the document workbench, enabling any of network access, mutations or concurrency forces a fresh manual project review even when the project's reduced-confirmation setting is on.

In the current sample-apply project, 58/156 source cases are routed to the API Contract lane and there is no associated approved API suite. The detailed case-family intake checklist is maintained in `test-plans/api-contract-intake-and-mapping-2026-10-18.md`; treat its families as capability hints, not endpoint facts.

## SQLite migration tools

| Stage | Tool | Gate / result |
|---|---|---|
| Prepare | `testpilot_prepare_sqlite_migration_test` | Accepts suite JSON plus a path-to-SQL map; validates and saves a draft only. It does not connect to a database or execute SQL. |
| Inspect | `testpilot_get_sqlite_migration_test` | Reads the suite, SQL sources, digest and review state. |
| Revise | `testpilot_update_sqlite_migration_test` | Edits draft only, revalidates and increments the revision/digest. Reviewed versions are immutable. |
| Review | `testpilot_review_sqlite_migration_test` | Records explicit approval/rejection of the immutable content digest. |
| Execute | `testpilot_run_approved_sqlite_migration_test` | Requires approved matching content. Runs each scenario in a fresh in-memory SQLite child process with a memory cap and hard timeout. No external database, DB file, network or shell is used. |
| Deliver | `testpilot_export_sqlite_migration_run` | Returns structured run evidence, Markdown report and ZIP source package. The ZIP README documents deterministic CLI replay without AI. |

The suite JSON is version 1 and declares optional `baseline`, `fixtures`, ordered `migrations`, and scenarios. Every SQL source must be a safe relative `.sql` path and referenced exactly by the suite. Each source is capped at 512 KB; total SQL sources at 5 MB; there may be at most 100 migrations, 100 scenarios and 100 checks per scenario. Assertions are read-only single `SELECT` statements with at most 500 rows. Supported SQL is constrained to selected table/index DDL and DML. `ATTACH`, `DETACH`, `VACUUM`, `PRAGMA`, transaction-control statements, virtual tables and extension loading are refused. An expected final-migration failure can be declared so the runner can verify savepoint rollback. `blocked` timeout results are not product failures or passes.

## Local-project tools

| Stage | Tool | Gate / result |
|---|---|---|
| Discover | `testpilot_list_local_projects` | Returns server-registered profiles only. |
| Draft | `testpilot_create_local_script_candidate` | Uses a profile ID, requirement, and optional base64 document; returns a candidate version. |
| Review | `testpilot_review_local_script` | Approve or reject; only approved versions can run. |
| Execute | `testpilot_run_approved_local_script` | Starts the deterministic reusable script without invoking a model. |
| Inspect | `testpilot_get_local_run` | Returns status, summary, and artifact references. |
| Deliver | `testpilot_export_local_run` | For a terminal run linked to an approved version, returns the report and a ZIP containing the approved script snapshot. |

No tool accepts arbitrary shell commands or arbitrary project paths. To support a new project, register and review its profile in the application before exposing it through MCP.

## Data and transport notes

- Document fields are supplied as base64 content to avoid granting the MCP process broad filesystem access. Supported source formats are PDF, XMind, Markdown, and TXT, up to the service's 9 MB document limit.
- Website target URLs are passed to TestPilot for testing. Use only the intended, authorized environment. The service's browser runner applies its own navigation and side-effect restrictions.
- The MCP process must reach the same local data directory and service instance as the workbench. If the service is not running or the base URL is wrong, tools return an explicit connection/HTTP error.
- Tool annotations tell MCP hosts which operations are read-only. They do not replace TestPilot's server-side approval gates.
