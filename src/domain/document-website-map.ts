import type { DocumentSessionProfile } from './document-session-profile.js';
import type { BrowserCheck, DocumentProjectExecutionConfig } from './document-test-model.js';

export type NavigationTarget = { label: string; kind: 'link' | 'control'; occurrence: number; href?: string };
export type NavigationSnapshot = {
  evidenceId: string; capturedAt: string; route: string; title: string;
  headings: string[]; visibleText: string[]; controls: unknown[]; targets: NavigationTarget[];
};
export type WebsiteMapPage = { id: string; snapshot: NavigationSnapshot; path: NavigationTarget[] };
export type WebsiteMap = {
  id: string; projectId: string; targetUrl: string; profileKey: string; createdAt: string; updatedAt: string;
  state: 'running' | 'completed' | 'partial' | 'blocked';
  pages: WebsiteMapPage[];
  edges: Array<{ from: string; to?: string; target: NavigationTarget; status: 'visited' | 'blocked'; reason?: string }>;
  notices: string[]; operations: number;
  verifications?: Array<{ pageId: string; checkedAt: string; status: 'verified' | 'blocked'; reason?: string }>;
  decisionTrace?: Array<{ pageId: string; evidenceId: string; decision: 'follow-link' | 'stop'; appliedIndex: number; reason?: string }>;
  caseBindings?: Array<{ caseId?: string; caseDigest: string; pageId: string | null; reason: string; caseQuote?: string; pageQuote?: string; createdAt: string }>;
  runtimeVerification?: { state: 'unverified' | 'partial' | 'ready' | 'blocked'; verified: number; blocked: number; total: number; since: string; checkedAt?: string };
};
export type WebsiteMapProject = { id: string; targetUrl: string; activeSessionProfileId?: string; sessionProfiles?: DocumentSessionProfile[]; executionConfig?: DocumentProjectExecutionConfig; cases?: Array<Pick<BrowserCheck,'id'|'title'|'source'|'expected'|'preconditions'|'testData'> & {entryPath?:string}> };

/** Historical discovery completion and current-service path usability differ. */
export function summarizeWebsiteMapVerification(map: WebsiteMap, since: string): NonNullable<WebsiteMap['runtimeVerification']> {
  const latest = map.pages.map(page => (map.verifications ?? []).filter(v => v.pageId === page.id && v.checkedAt >= since).at(-1));
  const verified = latest.filter(v => v?.status === 'verified').length, blocked = latest.filter(v => v?.status === 'blocked').length;
  const checkedAt = latest.flatMap(v => v ? [v.checkedAt] : []).sort().at(-1);
  return { state: blocked ? 'blocked' : verified && verified === map.pages.length ? 'ready' : verified ? 'partial' : 'unverified', verified, blocked, total: map.pages.length, since, ...(checkedAt ? { checkedAt } : {}) };
}

/** Conservative navigation vocabulary, independent of model suggestions. */
export function isDiscoveryNavigationLabel(label: string): boolean {
  if (!label || label.length > 180 || /提交|保存|删除|支付|付款|确认|确定|发送|撤回|撤销|重置|退出|注销|审批通过|驳回|重新锁|导出|下载|新增|创建|submit|save|delete|pay|confirm|send|reset|logout|approve|reject|export|download|create/iu.test(label)) return false;
  return /历史|记录|列表|详情|明细|订单|物流|返回|首页|菜单|展开|收起|查看|我的|设置|申请编号|申请单号|样书申请|history|list|detail|orders?|back|home|menu|view|settings/iu.test(label);
}

/** Query-bearing detail routes are reusable; credentials and effectful paths are not. */
export function safeDiscoveryRoute(raw: string, base: string): string | undefined {
  if (!raw || raw.length > 1000 || /[\\\u0000-\u001f]/u.test(raw) || /(?:^|[/?&#=])(?:delete|remove|submit|logout|approve|reject|relock|pay|send|cancel)(?:[/?&#=]|$)/iu.test(raw)) return undefined;
  try {
    const target = new URL(base); const value = new URL(raw, target);
    if (!/^https?:$/u.test(value.protocol) || value.origin !== target.origin || value.username || value.password) return undefined;
    const queries = [value.search, value.hash.includes('?') ? value.hash.slice(value.hash.indexOf('?')) : ''];
    for (const query of queries) for (const [key] of new URLSearchParams(query)) {
      if (!/^(?:id|applyId|applyNo|orderId|r|page|tab|type|status)$/iu.test(key)) return undefined;
    }
    return value.pathname + value.search + value.hash;
  } catch { return undefined; }
}
