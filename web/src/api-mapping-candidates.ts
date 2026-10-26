export type MappingText = { id: string; title: string; source?: string; requirementRefs?: string[] };

const domainTerms = [
  '订单', '申请', '审批', '客户', '库存', '锁单', '物流', '快递', '图书', '商品', '重量', '手机号', '数量', '备注', '地址',
  '权限', '身份', '登录', '回调', '迁移', '出库', '供应商', '收件人', '店铺', '仓库', '状态', '取消', '退单', '接口', '模板',
  '认证', '授权', '搜索', '查询', '创建', '更新', '删除', '校验', '发货', 'token', 'auth', 'order', 'approval', 'customer',
  'inventory', 'stock', 'logistics', 'book', 'goods', 'shipment', 'callback', 'migration', 'user', 'role', 'login', 'cancel', 'return',
];
const genericTerms = new Set(['api', 'fixture', 'sample', 'requirements', 'requirement', 'page', 'test', 'case', 'get', 'post', 'put', 'patch', 'delete', 'health', 'ready', 'readiness', 'check', 'lookup']);

function tokens(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const found = new Set<string>();
  for (const term of domainTerms) if (normalized.includes(term)) found.add(term);
  for (const part of normalized.split(/\s+/u)) if (part.length >= 3 && /^[a-z0-9_-]+$/u.test(part) && !genericTerms.has(part)) found.add(part);
  return found;
}

/** Return review-only suggestions. This function never changes the persisted mapping. */
export function suggestApiMappingCandidates(documentCase: MappingText, apiCases: MappingText[], limit = 3): Array<{ id: string; score: number }> {
  const docTokens = tokens([documentCase.title, documentCase.source ?? '', ...(documentCase.requirementRefs ?? [])].join(' '));
  if (!docTokens.size) return [];
  return apiCases.map(apiCase => {
    const apiTokens = tokens([apiCase.title, apiCase.source ?? '', ...(apiCase.requirementRefs ?? [])].join(' '));
    const overlap = [...docTokens].filter(token => apiTokens.has(token));
    return { id: apiCase.id, score: overlap.length };
  }).filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, limit));
}
