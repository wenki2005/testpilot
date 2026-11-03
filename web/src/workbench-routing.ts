const pages = ['workbench', 'history', 'run-detail', 'regressions', 'architecture', 'project-tests', 'document-tests', 'case-generator', 'api-suites', 'sqlite-migrations', 'mysql-browser', 'source-tests', 'settings'] as const;
export type WorkbenchPage = typeof pages[number];

/** Explicit tool deep links take precedence over retained document context. */
export function resolveWorkbenchPage(location: { search: string; hash: string }): WorkbenchPage {
  const params = new URLSearchParams(location.search);
  const requested = params.get('page');
  if (pages.some(page => page === requested)) return requested as WorkbenchPage;
  if (params.get('documentProject') || location.hash.startsWith('#doc-')) return 'document-tests';
  return 'workbench';
}
