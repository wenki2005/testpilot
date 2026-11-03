import type { DemoConfig } from '../domain/demo-contracts.js';

/** Local instances share code, but own their data, accounts and execution state. */
export function integratedWorkspaceConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig['workspaces'] {
  if (!env.TESTPILOT_WORKSPACE) return undefined;
  if (!['dify', 'web-regression'].includes(env.TESTPILOT_WORKSPACE)) throw new Error('Unknown TestPilot workspace.');
  const localUrl = (value: string | undefined): string => {
    const url = new URL(value ?? '');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Workspace links must use a local HTTP origin with an explicit port.');
    }
    return url.origin;
  };
  return {
    current: env.TESTPILOT_WORKSPACE as 'dify' | 'web-regression',
    difyUrl: localUrl(env.TESTPILOT_DIFY_WORKSPACE_URL),
    webUrl: localUrl(env.TESTPILOT_WEB_WORKSPACE_URL),
    dataStatus: env.TESTPILOT_WORKSPACE_DATA_STATUS === 'migrated' ? 'migrated' : 'awaiting-source',
  };
}
