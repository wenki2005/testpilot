import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mysqlBrowserStatus, readDepartmentAgentDatabaseRows } from './mysql-readonly-browser.js';
import { checkDatabaseApplicationTotals, type DocumentDatabaseEvidence } from '../domain/document-database-evidence.js';
import type { BrowserCheck, DocumentProject } from '../domain/document-test-model.js';
import type { DocumentAuthoringContext } from '../domain/document-authoring-context.js';
import { actionablePreconditions } from '../domain/document-case-authoring.js';
import { missingRequiredAssertions } from '../domain/document-required-assertions.js';

const cache = new Map<string, { at: number; evidence: DocumentDatabaseEvidence }>();
/** Only the two directly observable detail checks may use this established fixture.
 * Identity, submission, synchronization and integration cases remain gated. */
export function bindDepartmentDatabaseFixture(project: DocumentProject, item: BrowserCheck, context?: DocumentAuthoringContext): BrowserCheck | undefined {
  const evidence = context?.databaseEvidence;
  if (!isDepartmentDatabaseTarget(project) || !['case-75','case-79'].includes(item.id) || item.confidence === 'low' || !evidence || evidence.projectId !== project.id
    || Date.now() - Date.parse(evidence.capturedAt) > 60000 || actionablePreconditions(item).length && !item.preconditionsConfirmed) return undefined;
  const record = evidence.applicationChecks.find(check => check.goodsCount >= 2 && check.amountConsistent && check.weightConsistent);
  if (!record) return undefined;
  const goods = evidence.queries.find(query => query.key === 'goods')?.rows.filter(row => row.apply_no === record.applyNo) ?? [];
  const required = item.id === 'case-75' ? [...goods.flatMap(row => [String(row.product_id), String(row.subtotal)]), record.amount, (Number(record.weightGrams) / 1000).toFixed(2)] : [];
  // requiredAssertions contains source requirement literals only. Actual fixture
  // values are separate observations, validated against the frozen context below.
  return { ...item, testData: [...new Set([...(item.testData ?? []), `只读记录 ${record.applyNo}；本次数据库证据 ${evidence.id}；数值核对 ${required.join('、')}；不创建或修改业务记录。`])] };
}
export function missingDepartmentDatabaseFixtureAssertion(project: DocumentProject, item: BrowserCheck, context?: DocumentAuthoringContext): string | undefined {
  if (!isDepartmentDatabaseTarget(project) || item.id !== 'case-75' || context?.databaseEvidence?.projectId !== project.id) return undefined;
  const evidence = context.databaseEvidence;
  const record = evidence.applicationChecks.find(check => check.goodsCount >= 2 && check.amountConsistent && check.weightConsistent);
  if (!record) return '数据库未提供可核验的多行金额与重量夹具。';
  const goods = evidence.queries.find(query => query.key === 'goods')?.rows.filter(row => row.apply_no === record.applyNo) ?? [];
  const values = [...goods.flatMap(row => [String(row.product_id), String(row.subtotal)]), record.amount, (Number(record.weightGrams) / 1000).toFixed(2)];
  return missingRequiredAssertions({ steps: item.steps, requiredAssertions: values });
}
export function isDepartmentDatabaseTarget(project: { id: string; targetUrl: string }): boolean {
  const url = new URL(project.targetUrl);
  return project.id === 'eaf7b01a-51a2-4e66-bb5e-37d662c4306c' && url.origin === 'https://cdn.yibentushu.com' && url.pathname.startsWith('/test-sample-apply/');
}
export async function collectDocumentAgentDatabaseEvidence(project: { id: string; targetUrl: string }, fresh = false): Promise<DocumentDatabaseEvidence | undefined> {
  if (!isDepartmentDatabaseTarget(project)) return undefined;
  const current = cache.get(project.id);
  if (!fresh && current && Date.now() - current.at < 10000 && mysqlBrowserStatus().connected) return structuredClone(current.evidence);
  const connection = mysqlBrowserStatus();
  if (!connection.connected) throw new Error('Agent 数据库核验未执行：当前运行服务的数据库未连接。');
  const queries = await readDepartmentAgentDatabaseRows();
  const body = { id: randomUUID(), projectId: project.id, capturedAt: new Date().toISOString(), database: connection.database, readonly: true as const,
    encrypted: connection.encrypted, certificateVerified: connection.certificateVerified, queries,
    applicationChecks: checkDatabaseApplicationTotals(queries.find(q => q.key === 'applications')!.rows, queries.find(q => q.key === 'goods')!.rows),
    limitation: '本次只读查询仅证明所列记录的当前事实和数值一致性；不证明提交因果、角色权限、缓存实时性、审批或仓储流程通过。is_valid 原值不代替业务含义。' };
  const evidence = { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
  const directory = path.join(path.resolve(process.env.TESTPILOT_DATA_DIR ?? 'artifacts/demo'), 'document-tests', 'database-evidence');
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${evidence.id}.json`), temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(evidence), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, destination);
  cache.set(project.id, { at: Date.now(), evidence });
  return structuredClone(evidence);
}
