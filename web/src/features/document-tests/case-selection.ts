type SelectionCase = { id: string; title: string; entryPath?: string; modulePath?: string[]; tags?: string[]; requirementRefs?: string[]; lifecycleStatus?: 'draft' | 'runnable' | 'disabled' };
type SelectionProject = { cases: SelectionCase[]; apiContract?: { mappings?: Array<{ documentCaseId: string; apiCaseIds: string[] }> } };
export type ImpactCandidate = { caseId: string; title: string; reasons: string[] };

export function pageEntryRoute(entryPath?: string): string {
  if (!entryPath?.trim()) return '';
  try {
    const parsed = new URL(entryPath.trim(), 'https://testpilot.invalid');
    const route = /^#\//u.test(parsed.hash) ? parsed.hash.slice(1).split('?')[0] ?? '/' : parsed.pathname;
    const normalized = route.replace(/\/+$/u, '') || '/';
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  } catch { return entryPath.trim(); }
}

function pageEntryRouteSegments(entryPath?: string): string[] {
  return pageEntryRoute(entryPath).split('/').filter(Boolean);
}

export const canSelectCaseForRun = (item: SelectionCase) => item.lifecycleStatus !== 'draft' && item.lifecycleStatus !== 'disabled';

export function findRelatedCaseCandidates(project: SelectionProject, targetCaseIds: string[], existingImpactCaseIds: string[] = []): ImpactCandidate[] {
  const targets = project.cases.filter(item => targetCaseIds.includes(item.id));
  const selectedIds = new Set([...targetCaseIds, ...existingImpactCaseIds]);
  const mappedApis = new Map<string, Set<string>>();
  for (const mapping of project.apiContract?.mappings ?? []) mappedApis.set(mapping.documentCaseId, new Set(mapping.apiCaseIds));
  const shared = (left: string[] = [], right: string[] = []) => {
    const values = new Set(left.map(item => item.trim().toLocaleLowerCase()).filter(Boolean));
    return right.filter(item => values.has(item.trim().toLocaleLowerCase()));
  };
  return project.cases.flatMap(candidate => {
    if (selectedIds.has(candidate.id) || !canSelectCaseForRun(candidate)) return [];
    const reasons = new Set<string>();
    for (const target of targets) {
      const leftRoute = pageEntryRouteSegments(target.entryPath);
      const rightRoute = pageEntryRouteSegments(candidate.entryPath);
      let sharedRouteDepth = 0;
      while (sharedRouteDepth < leftRoute.length && sharedRouteDepth < rightRoute.length && leftRoute[sharedRouteDepth]!.toLocaleLowerCase() === rightRoute[sharedRouteDepth]!.toLocaleLowerCase()) sharedRouteDepth++;
      const sharedRouteIsSpecific = sharedRouteDepth >= 2 || sharedRouteDepth > 0 && sharedRouteDepth === Math.min(leftRoute.length, rightRoute.length);
      if (leftRoute.length && rightRoute.length && sharedRouteDepth === leftRoute.length && sharedRouteDepth === rightRoute.length) reasons.add(`同一页面路由（忽略筛选参数）：/${leftRoute.join('/')}`);
      else if (sharedRouteIsSpecific) reasons.add(`共享页面路由：/${leftRoute.slice(0, sharedRouteDepth).join('/')}`);
      const leftPath = target.modulePath?.filter(Boolean) ?? [];
      const rightPath = candidate.modulePath?.filter(Boolean) ?? [];
      let sharedDepth = 0;
      while (sharedDepth < leftPath.length && sharedDepth < rightPath.length && leftPath[sharedDepth]!.trim().toLocaleLowerCase() === rightPath[sharedDepth]!.trim().toLocaleLowerCase()) sharedDepth++;
      if (leftPath.length > 0 && leftPath.length === rightPath.length && sharedDepth === leftPath.length) reasons.add(`同一功能路径：${leftPath.join(' / ')}`);
      else if (sharedDepth >= 2) reasons.add(`共享上级页面：${leftPath.slice(0, sharedDepth).join(' / ')}`);
      else if (sharedDepth === 1 && leftPath.length === 1 && rightPath.length === 1) reasons.add(`同一业务模块：${leftPath[0]}`);
      const tags = shared(target.tags, candidate.tags);
      if (tags.length) reasons.add(`共享标签：${tags.join('、')}`);
      const refs = shared(target.requirementRefs, candidate.requirementRefs);
      if (refs.length) reasons.add(`关联同一需求引用：${refs[0]!.slice(0, 80)}`);
      const leftApis = mappedApis.get(target.id);
      const rightApis = mappedApis.get(candidate.id);
      const apiIds = leftApis && rightApis ? [...leftApis].filter(id => rightApis.has(id)) : [];
      if (apiIds.length) reasons.add(`映射到相同 API 检查：${apiIds.join('、')}`);
    }
    return reasons.size ? [{ caseId: candidate.id, title: candidate.title, reasons: [...reasons] }] : [];
  }).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}
