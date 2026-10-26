import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RunRecord } from "../domain/types.js";

export async function saveRun(record: RunRecord, outputRoot: string): Promise<string> {
  const runDirectory = resolve(outputRoot, record.runId);
  await mkdir(runDirectory, { recursive: true });
  const jsonPath = resolve(runDirectory, "run.json");
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await writeFile(resolve(runDirectory, "report.md"), renderMarkdown(record), "utf8");
  return jsonPath;
}

function renderMarkdown(record: RunRecord): string {
  const lines = [
    `# TestPilot Run: ${record.suiteName}`,
    "",
    `- **Run ID:** \`${record.runId}\``,
    `- **Mode:** ${record.mode}`,
    `- **Status:** ${record.status.toUpperCase()}`,
    `- **Started:** ${record.startedAt}`,
    `- **Duration:** ${record.durationMs} ms`,
    `- **Scope:** ${record.scope.length ? record.scope.join(", ") : "Not specified"}`,
    ...(record.approvedScript ? [`- **Approved script:** \`${record.approvedScript.id}\` v${record.approvedScript.version} (SHA-256 \`${record.approvedScript.digest}\`)`] : []),
    "",
    "## Results",
    "",
    "| Case | Status | Linked requirements / source | Expected | Actual | Duration |",
    "|---|---:|---|---|---|---:|",
  ];

  for (const item of record.results) {
    const trace = item.designTrace ? [item.designTrace.requirementRefs?.join(", "), item.designTrace.source, item.designTrace.priority ? `Priority: ${item.designTrace.priority}` : ""].filter(Boolean).join(" · ") : "—";
    lines.push(`| ${item.title.replaceAll("|", "\\|")} | ${item.status} | ${trace.replaceAll("|", "\\|")} | ${(item.assertion?.expected ?? `exit ${item.expectedExitCode ?? "—"}`).replaceAll("|", "\\|")} | ${(item.assertion?.actual ?? (item.actualExitCode == null ? "—" : `exit ${item.actualExitCode}`)).replaceAll("|", "\\|")} | ${item.durationMs} ms |`);
  }
  if (record.results.length === 0) lines.push("| No case executed | blocked | — | — | — | 0 ms |");

  if (record.apiDesignAssessment) {
    const checks = record.apiDesignAssessment.checks;
    const totals = ["confirmed", "mismatch", "no-response", "partial-response", "not-run", "not-authored", "manual-review"].map(status => `${status}: ${checks.filter(check => check.status === status).length}`).join(" · ");
    lines.push("", "## OpenAPI design targets vs observed run", "", `Status-class comparison only; each case's full pass/fail assertion remains in Results. ${totals}`, "", "| Category | Operation / requirement | Case | Expected response | Observed HTTP | Case result | Assessment |", "|---|---|---|---|---|---|---|");
    for (const check of checks) {
      const observed = check.observedStatuses.length ? [...new Set(check.observedStatuses)].map(status => `HTTP ${status}`).join(", ") : "No HTTP response";
      const caseStatus = check.resultStatus ?? "—";
      lines.push(`| ${check.category} | ${[check.operationKey, check.requirementId, check.label].filter(Boolean).join(" · ").replaceAll("|", "\\|")} | ${check.caseId ?? "—"} | ${check.expectedResponse} | ${observed} | ${caseStatus} | ${check.status} |`);
    }
  }

  if (record.sqliteMigration) {
    lines.push("", "## SQLite migration evidence", "", `- Suite SHA-256: \`${record.sqliteMigration.suiteDigest}\``, `- SQLite runtime: ${record.sqliteMigration.sqliteVersion}`, "");
    for (const scenario of record.sqliteMigration.scenarios) {
      lines.push(`### Scenario ${scenario.scenarioId} · ${scenario.status}`, "");
      if (scenario.migrationEvents.length) {
        lines.push("| Migration | Result | Detail |", "|---|---|---|");
        for (const event of scenario.migrationEvents) lines.push(`| ${event.migrationId} | ${event.status} | ${(event.message ?? "").replaceAll("|", "\\|")} |`);
        lines.push("");
      }
      if (scenario.checks.length) {
        lines.push("| Check | Result | Expected rows | Actual rows / error |", "|---|---|---|---|");
        for (const check of scenario.checks) {
          const expected = JSON.stringify(check.expectedRows).replaceAll("|", "\\|");
          const actual = (check.actualRows ? JSON.stringify(check.actualRows) : check.error ?? "—").replaceAll("|", "\\|");
          lines.push(`| ${check.checkId}: ${check.title.replaceAll("|", "\\|")} | ${check.status} | \`${expected}\` | \`${actual}\` |`);
        }
        lines.push("");
      }
    }
  }

  lines.push("", "## Evidence", "");
  for (const item of record.results) {
    lines.push(`### ${item.caseId}: ${item.title}`, "");
    if (item.error) lines.push(`Error: ${item.error}`, "");
    for (const evidence of item.evidence) {
      const body = evidence.content.length > 12_000 ? `${evidence.content.slice(0, 12_000)}\n[truncated]` : evidence.content;
      lines.push(`#### ${evidence.kind}`, "", "```text", body, "```", "");
    }
  }
  if (record.limitations.length) {
    lines.push("## Limitations", "", ...record.limitations.map((item) => `- ${item}`), "");
  }
  return `${lines.join("\n")}\n`;
}
