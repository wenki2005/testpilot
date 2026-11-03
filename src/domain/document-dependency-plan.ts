import type { BrowserCheck } from "./document-test-model.js";

export type DocumentDependencyPlan = {
  orderedCases: BrowserCheck[];
  prerequisiteCaseIds: string[];
  dependencyChains: Record<string, string[]>;
};

/** Expand explicit case dependencies into a deterministic, validated DAG order. */
export function planDocumentCaseDependencies(cases: BrowserCheck[], requestedCaseIds: string[]): DocumentDependencyPlan {
  if (!requestedCaseIds.length || new Set(requestedCaseIds).size !== requestedCaseIds.length) throw new Error("依赖计划需要非空且不重复的目标用例 ID。");
  const byId = new Map(cases.map(item => [item.id, item]));
  if (byId.size !== cases.length) throw new Error('项目存在重复用例 ID，无法建立唯一依赖图。');
  const roots = requestedCaseIds.map(id => {
    const item = byId.get(id);
    if (!item) throw new Error(`依赖计划中的目标用例不存在：${id}`);
    if (item.lifecycleStatus === "draft" || item.lifecycleStatus === "disabled") throw new Error(`草稿或停用用例不能运行：${id}`);
    return item;
  });
  const ordered: BrowserCheck[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const prerequisiteIds = new Set<string>();
  const chains: Record<string, string[]> = {};
  const visit = (item: BrowserCheck, chain: string[]): void => {
    if (visiting.has(item.id)) throw new Error(`用例前置依赖存在循环：${[...chain, item.id].join(" → ")}`);
    if (visited.has(item.id)) return;
    visiting.add(item.id);
    const dependencies = item.dependsOnCaseIds ?? [];
    if (!Array.isArray(dependencies) || dependencies.some(id => typeof id !== "string" || !id.trim()) || new Set(dependencies).size !== dependencies.length) throw new Error(`用例 ${item.id} 的 dependsOnCaseIds 必须是唯一、有效的用例 ID。`);
    for (const id of dependencies) {
      if (id === item.id) throw new Error(`用例 ${item.id} 不能依赖自身。`);
      const dependency = byId.get(id);
      if (!dependency) throw new Error(`用例 ${item.id} 引用了当前项目不存在的前置用例 ${id}。`);
      if (dependency.lifecycleStatus === "draft" || dependency.lifecycleStatus === "disabled") throw new Error(`用例 ${item.id} 的前置用例 ${id} 为草稿或停用状态，不能自动运行。`);
      prerequisiteIds.add(id);
      chains[id] = [...chain, item.id];
      visit(dependency, [...chain, item.id]);
    }
    visiting.delete(item.id);
    visited.add(item.id);
    ordered.push(item);
  };
  for (const item of roots) visit(item, []);
  // Keep connected prerequisite chains together. Otherwise a selected
  // independent root between parent and child resets their shared page state.
  const parent=new Map(ordered.map(item=>[item.id,item.id]));
  const find=(id:string):string=>{const next=parent.get(id)!;return next===id?id:find(next);};
  for(const item of ordered)for(const dependency of item.dependsOnCaseIds ?? [])parent.set(find(item.id),find(dependency));
  const groups=new Map<string,BrowserCheck[]>();
  for(const item of ordered){const key=find(item.id);const group=groups.get(key) ?? [];group.push(item);groups.set(key,group);}
  const grouped=[...groups.values()].flat();
  const targetSet = new Set(requestedCaseIds);
  return { orderedCases: grouped, prerequisiteCaseIds: [...prerequisiteIds].filter(id => !targetSet.has(id)), dependencyChains: chains };
}

/** Structural preview only; it never changes lifecycle or authorizes execution. */
export function previewDocumentCaseDependencies(cases: BrowserCheck[], requestedCaseIds: string[]) {
  const plan = planDocumentCaseDependencies(cases.map(item => ({ ...item, lifecycleStatus: 'runnable' })), requestedCaseIds);
  const ids = plan.orderedCases.map(item => item.id);
  const blockers = cases.filter(item => ids.includes(item.id) && (item.lifecycleStatus === 'draft' || item.lifecycleStatus === 'disabled')).map(item => ({ caseId: item.id, lifecycleStatus: item.lifecycleStatus }));
  return { structuralOnly: true, orderedCaseIds: ids, prerequisiteCaseIds: plan.prerequisiteCaseIds, dependencyChains: plan.dependencyChains, blockers, lifecycleReady: blockers.length === 0 };
}
