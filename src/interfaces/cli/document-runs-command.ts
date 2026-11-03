const allowedOptions = new Set(['--server', '--project', '--run', '--action', '--case']);
const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const safeCaseId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u;
const allowedActions = new Set(['status', 'start', 'resume', 'pause', 'continue', 'cancel']);

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  const caseIds: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const name = args[index]!;
    if (!allowedOptions.has(name)) throw new Error(`Unknown option: ${name}`);
    if (name === '--case') {
      const caseId = args[index + 1];
      if (!caseId || caseId.startsWith('--')) throw new Error('Missing value for --case');
      if (!safeCaseId.test(caseId)) throw new Error('Invalid case ID.');
      if (caseIds.includes(caseId)) throw new Error('Case ID may only be provided once.');
      caseIds.push(caseId); index++; continue;
    }
    if (values.has(name)) throw new Error(`Option may only be provided once: ${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    values.set(name, value); index++;
  }
  const server = values.get('--server') ?? 'http://127.0.0.1:4317';
  let url: URL;
  try { url = new URL(server); } catch { throw new Error('--server must be a loopback HTTP origin.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('--server must be a loopback HTTP origin without credentials, path, query, or fragment.');
  }
  const project = values.get('--project'); const run = values.get('--run'); const action = values.get('--action') ?? 'status';
  if (project && !safeId.test(project)) throw new Error('Invalid project ID.');
  if (run && !safeId.test(run)) throw new Error('Invalid run ID.');
  if (!allowedActions.has(action)) throw new Error('Action must be status, start, resume, pause, continue, or cancel.');
  if (!run && !project) throw new Error('Provide --project or --run.');
  if (action === 'resume') {
    if (!project || !run) throw new Error('Resume action requires both --project and --run.');
  } else if (run && project) {
    throw new Error('Choose either --project or --run, except --action resume which requires both.');
  }
  if (action === 'start') {
    if (!project) throw new Error('Start action requires --project.');
    if (!caseIds.length) throw new Error('Start action requires at least one --case.');
  } else {
    if (caseIds.length) throw new Error('--case is only valid with --action start.');
    if (action !== 'status' && action !== 'resume' && !run) throw new Error('Control actions require --run.');
  }
  return { origin: url.origin, project, run, action, caseIds };
}

export async function requestDocumentRun(args: string[], fetcher: typeof fetch = fetch): Promise<unknown> {
  const { origin, project, run, action, caseIds } = parseArgs(args);
  const path = project
    ? action === 'start'
      ? `/api/document-projects/${encodeURIComponent(project)}/start`
      : action === 'resume'
        ? `/api/document-projects/${encodeURIComponent(project)}/resume`
        : `/api/document-projects/${encodeURIComponent(project)}/runs`
    : action === 'status'
      ? `/api/document-runs/${encodeURIComponent(run!)}/progress`
      : `/api/document-runs/${encodeURIComponent(run!)}/${action}`;
  const method = action === 'status' ? 'GET' : 'POST';
  const requestBody = action === 'start' ? {
    runMode: 'regression',
    selectedCaseIds: caseIds,
    scopePlan: { mode: caseIds.length === 1 ? 'single' : 'feature', targetCaseIds: caseIds, impactCaseIds: [] },
  } : action === 'resume' ? { runId: run } : undefined;
  const response = await fetcher(`${origin}${path}`, {
    method,
    ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody ?? {}) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error('TestPilot API redirects are not allowed.');
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; } catch { throw new Error(`TestPilot API returned invalid JSON (${response.status}).`); }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : `HTTP ${response.status}`;
    throw new Error(`TestPilot API request failed: ${detail}`);
  }
  return payload;
}

export async function runDocumentRunsCommand(args: string[]): Promise<void> {
  const result = await requestDocumentRun(args);
  console.log(JSON.stringify(result, null, 2));
}
