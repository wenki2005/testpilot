/** Source observations help design a test; they never replace its requirement or a live result. */
export type DocumentAuthoringSourceReference = {
  label: string;
  path: string;
  sha256: string;
  startLine: number;
  endLine: number;
};
export type DocumentAuthoringContext = {
  sources: Array<DocumentAuthoringSourceReference & { excerpt: string }>;
  database: { connected: boolean; capability: 'read-only-explorer'; resultEvidence: false };
  warnings: string[];
  databaseEvidence?: import('./document-database-evidence.js').DocumentDatabaseEvidence;
};
