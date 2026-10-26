/**
 * Find and terminate browser processes that tests left behind.
 *
 * Why this is needed: a document test drives a *persistent* Edge profile, and
 * the product deliberately keeps that browser alive across TestPilot server
 * restarts (the user's login session is reused). In tests that means the
 * browser outlives the test unless something closes it. A single full run of
 * this suite left 378 orphaned msedge processes behind, some of them from
 * previous sessions, and those processes hold file locks on the very profile
 * directories cleanup is trying to delete (EBUSY on
 * CrashpadMetrics-active.pma). Cleaning the disk without reaping the processes
 * therefore does nothing.
 *
 * Scope safety: a process is only considered test-owned when its command line
 * carries a --user-data-dir inside one of the given roots. The user's own Edge
 * profile never matches, so it is never touched.
 */

import { execFileSync } from "node:child_process";

/**
 * @param {string[]} roots Absolute directories that test browser profiles live under.
 * @param {{ createdAfter?: number }} [options] Only report processes started at/after this epoch-ms.
 * @returns {Array<{ pid: number, startedAt: number, commandLine: string }>}
 */
export function listTestBrowsers(roots, options = {}) {
  if (!roots.length) return [];
  // Statements must be separated by ';' — joining them with only a space makes
  // PowerShell parse the whole thing as one malformed command, which used to
  // fail silently and make every reap a no-op.
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" |",
    "  Select-Object ProcessId,CreationDate,CommandLine |",
    "  ConvertTo-Json -Compress -Depth 3",
  ].join(" ");

  let stdout;
  try {
    stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    // Never fail the caller, but never hide the failure either: a silent error
    // here looks exactly like "no browsers to reap", which is how this feature
    // was dead for a while without anyone noticing.
    console.warn(`warning: could not enumerate test browsers (${error.message.split("\n")[0]}); cleanup may hit EBUSY.`);
    return [];
  }

  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return []; }
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  const normalizedRoots = roots.map(r => r.replace(/\//g, "\\").toLowerCase());
  const results = [];
  for (const row of rows) {
    const commandLine = String(row.CommandLine ?? "");
    if (!commandLine) continue;
    const normalizedCmd = commandLine.replace(/\//g, "\\").toLowerCase();
    if (!normalizedRoots.some(root => normalizedCmd.includes(root))) continue;

    // CreationDate arrives as ISO-8601 on modern PowerShell; tolerate /Date(...)/ too.
    let startedAt = 0;
    const raw = String(row.CreationDate ?? "");
    const dotNetMatch = raw.match(/\/Date\((\d+)/);
    if (dotNetMatch) startedAt = Number(dotNetMatch[1]);
    else if (raw) startedAt = Date.parse(raw) || 0;

    if (options.createdAfter && startedAt && startedAt < options.createdAfter) continue;
    results.push({ pid: Number(row.ProcessId), startedAt, commandLine });
  }
  return results;
}

/** Terminate the given PIDs (and their children). Returns how many were killed. */
export function terminatePids(pids) {
  let killed = 0;
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
      killed++;
    } catch {
      // Already exited, or a child that died with its parent — both fine.
    }
  }
  return killed;
}
