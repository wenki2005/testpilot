import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { canSelectCaseForRun, findRelatedCaseCandidates, pageEntryRoute, type ImpactCandidate } from '../case-selection';
import type { Project, Run, RunScopePlan } from '../types';
/** Owns the selected regression scope, module/page filters and explicit impact additions. */
export function useDocumentCaseSelection(project: Project | undefined, selectedProjectId: string, setProjects: Dispatch<SetStateAction<Project[]>>, setRun: Dispatch<SetStateAction<Run | null>>, setMessage: Dispatch<SetStateAction<string>>) {
    const [selectedModuleKeys, setSelectedModuleKeys] = useState<string[]>([]);
    const [selectedPageRouteKeys, setSelectedPageRouteKeys] = useState<string[]>([]);
    const [runScopePlan, setRunScopePlan] = useState<RunScopePlan | null>(null);
    const [impactCandidates, setImpactCandidates] = useState<ImpactCandidate[]>([]);
    const [impactCandidateSelection, setImpactCandidateSelection] = useState<string[]>([]);
    const selectedCases = project?.cases.filter(item => canSelectCaseForRun(item) && item.selectedForRegression !== false) ?? [];
    const runnableCaseCount = project?.cases.filter(canSelectCaseForRun).length ?? 0;
    const selectedCaseIds = selectedCases.map(item => item.id);
    const selectedCaseIdSet = new Set(selectedCaseIds);
    const plannedTargets = (runScopePlan?.targetCaseIds ?? []).filter(id => selectedCaseIdSet.has(id));
    const plannedImpacts = (runScopePlan?.impactCaseIds ?? []).filter(id => selectedCaseIdSet.has(id) && !plannedTargets.includes(id));
    const unclassifiedSelected = selectedCaseIds.filter(id => !plannedTargets.includes(id) && !plannedImpacts.includes(id));
    const effectiveScopePlan: RunScopePlan = {
        mode: runScopePlan?.mode ?? (selectedCaseIds.length === runnableCaseCount ? 'full' : selectedCaseIds.length === 1 ? 'single' : 'custom'),
        targetCaseIds: [...plannedTargets, ...unclassifiedSelected],
        impactCaseIds: plannedImpacts,
        ...(runScopePlan?.impactReasons ? { impactReasons: Object.fromEntries(Object.entries(runScopePlan.impactReasons).filter(([id]) => plannedImpacts.includes(id))) } : {}),
    };
    const selectedCaseCount = selectedCases.length;
    const moduleOptions = (() => {
        const paths = new Map<string, string[]>();
        for (const item of project?.cases ?? []) {
            const path = item.modulePath?.filter(Boolean) ?? [];
            for (let depth = 1; depth <= path.length; depth++) {
                const prefix = path.slice(0, depth);
                paths.set(JSON.stringify(prefix), prefix);
            }
        }
        if ((project?.cases ?? []).some(item => !(item.modulePath?.filter(Boolean).length)))
            paths.set('__unassigned__', ['未分配模块']);
        return [...paths.entries()].sort((a, b) => a[1].join(' / ').localeCompare(b[1].join(' / '), 'zh-CN'));
    })();
    const moduleOptionKeys = moduleOptions.map(([key]) => key).join('\u0000');
    const pageEntryOptions = (() => {
        const counts = new Map<string, {
            totalCount: number;
            runnableCount: number;
        }>();
        for (const item of project?.cases ?? []) {
            const route = pageEntryRoute(item.entryPath);
            if (!route)
                continue;
            const count = counts.get(route) ?? { totalCount: 0, runnableCount: 0 };
            count.totalCount += 1;
            if (canSelectCaseForRun(item))
                count.runnableCount += 1;
            counts.set(route, count);
        }
        return [...counts.entries()].map(([route, count]) => ({ route, ...count })).sort((a, b) => a.route.localeCompare(b.route, 'zh-CN'));
    })();
    const pageOptionKeys = pageEntryOptions.map(item => item.route).join('\u0000');
    const unassignedPageCaseCount = project?.cases.filter(item => canSelectCaseForRun(item) && !pageEntryRoute(item.entryPath)).length ?? 0;
    const selectedPageRouteSet = new Set(selectedPageRouteKeys);
    const selectedPageCaseCount = project?.cases.filter(item => canSelectCaseForRun(item) && selectedPageRouteSet.has(pageEntryRoute(item.entryPath))).length ?? 0;
    useEffect(() => {
        setSelectedModuleKeys([]);
        setSelectedPageRouteKeys([]);
        setRunScopePlan(null);
        setImpactCandidates([]);
        setImpactCandidateSelection([]);
    }, [selectedProjectId]);
    useEffect(() => { setSelectedModuleKeys(current => current.filter(key => moduleOptions.some(([optionKey]) => optionKey === key))); }, [moduleOptionKeys]);
    useEffect(() => { setSelectedPageRouteKeys(current => current.filter(key => pageEntryOptions.some(option => option.route === key))); }, [pageOptionKeys]);
    const clearImpactCandidates = () => { setImpactCandidates([]); setImpactCandidateSelection([]); };
    const setCaseSelection = (predicate: (item: Project['cases'][number]) => boolean, mode: RunScopePlan['mode'] = 'custom') => {
        if (!project)
            return;
        const cases = project.cases.map(item => ({ ...item, selectedForRegression: canSelectCaseForRun(item) && predicate(item) }));
        const targetCaseIds = cases.filter(item => canSelectCaseForRun(item) && item.selectedForRegression !== false).map(item => item.id);
        setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
        setRunScopePlan({ mode: mode === 'single' && targetCaseIds.length !== 1 ? 'custom' : mode, targetCaseIds, impactCaseIds: [] });
        setRun(null);
        clearImpactCandidates();
    };
    const toggleModuleSelection = (key: string, checked: boolean) => setSelectedModuleKeys(current => checked ? [...new Set([...current, key])] : current.filter(item => item !== key));
    const togglePageRouteSelection = (route: string, checked: boolean) => setSelectedPageRouteKeys(current => checked ? [...new Set([...current, route])] : current.filter(item => item !== route));
    const applyModuleSelection = () => {
        const selected = new Set(selectedModuleKeys);
        setCaseSelection(item => (!(item.modulePath?.filter(Boolean).length) && selected.has('__unassigned__')) || (item.modulePath ?? []).some((_segment, index) => selected.has(JSON.stringify(item.modulePath!.slice(0, index + 1)))), 'feature');
    };
    const applyPageSelection = () => {
        if (!project || !selectedPageRouteKeys.length || !selectedPageCaseCount)
            return;
        const selectedRoutes = new Set(selectedPageRouteKeys);
        setCaseSelection(item => selectedRoutes.has(pageEntryRoute(item.entryPath)), selectedPageCaseCount === 1 ? 'single' : 'feature');
        setMessage(`已按页面入口选中 ${selectedPageCaseCount} 条可运行用例；${unassignedPageCaseCount ? `${unassignedPageCaseCount} 条未标注页面入口的用例不会自动纳入。` : '所有可运行用例均已标注页面入口。'}`);
    };
    const toggleCaseSelection = (index: number, checked: boolean) => {
        if (!project)
            return;
        const target = project.cases[index];
        if (!target || !canSelectCaseForRun(target))
            return;
        const cases = project.cases.map((item, i) => i === index ? { ...item, selectedForRegression: checked } : item);
        setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
        const currentTargets = effectiveScopePlan.targetCaseIds.filter(id => id !== target.id);
        const currentImpacts = effectiveScopePlan.impactCaseIds.filter(id => id !== target.id);
        if (checked)
            currentTargets.push(target.id);
        const nextMode: RunScopePlan['mode'] = currentImpacts.length ? 'impact' : currentTargets.length === 1 ? 'single' : 'custom';
        const impactReasons = Object.fromEntries(Object.entries(effectiveScopePlan.impactReasons ?? {}).filter(([id]) => currentImpacts.includes(id)));
        setRunScopePlan({ mode: nextMode, targetCaseIds: currentTargets, impactCaseIds: currentImpacts, ...(Object.keys(impactReasons).length ? { impactReasons } : {}) });
        clearImpactCandidates();
        setRun(null);
    };
    const selectOnlyCase = (caseId: string) => {
        if (!project)
            return;
        const target = project.cases.find(item => item.id === caseId);
        if (!target || !canSelectCaseForRun(target))
            return;
        const cases = project.cases.map(item => ({ ...item, selectedForRegression: item.id === caseId }));
        setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
        setRunScopePlan({ mode: 'single', targetCaseIds: [caseId], impactCaseIds: [] });
        setRun(null);
        clearImpactCandidates();
    };
    const analyzeRelatedCases = () => {
        if (!project || !effectiveScopePlan.targetCaseIds.length)
            return;
        const candidates = findRelatedCaseCandidates(project, effectiveScopePlan.targetCaseIds, effectiveScopePlan.impactCaseIds);
        setImpactCandidates(candidates);
        setImpactCandidateSelection([]);
        setMessage(candidates.length ? `按模块路径、需求引用、标签和 API 映射找到 ${candidates.length} 条关联候选；勾选确认后才会运行。` : '没有找到带有明确模块、需求、标签或 API 关系的用例；其余用例仍显示为未验证。');
    };
    const addSelectedImpactCases = () => {
        if (!project || !impactCandidateSelection.length)
            return;
        const candidates = new Set(impactCandidateSelection.filter(id => impactCandidates.some(item => item.caseId === id)));
        const targetIds = effectiveScopePlan.targetCaseIds;
        const impactIds = [...new Set([...effectiveScopePlan.impactCaseIds, ...candidates])].filter(id => !targetIds.includes(id));
        const included = new Set([...targetIds, ...impactIds]);
        const cases = project.cases.map(item => canSelectCaseForRun(item) ? { ...item, selectedForRegression: included.has(item.id) } : item);
        setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
        const candidateReasons = Object.fromEntries([...candidates]
            .map(id => [id, (impactCandidates.find(item => item.caseId === id)?.reasons ?? []).slice(0, 10).map(reason => reason.slice(0, 300))] as const)
            .filter(([, reasons]) => reasons.length > 0));
        const impactReasons = { ...effectiveScopePlan.impactReasons, ...candidateReasons };
        setRunScopePlan({ mode: 'impact', targetCaseIds: targetIds, impactCaseIds: impactIds, ...(Object.keys(impactReasons).length ? { impactReasons } : {}) });
        setMessage(`已把 ${candidates.size} 条关联影响用例加入本轮；直接目标与影响检查会分组记录。`);
        clearImpactCandidates();
    };
    const clearImpactCases = () => {
        if (!project || !effectiveScopePlan.impactCaseIds.length)
            return;
        const targetIds = new Set(effectiveScopePlan.targetCaseIds);
        const cases = project.cases.map(item => canSelectCaseForRun(item) ? { ...item, selectedForRegression: targetIds.has(item.id) } : item);
        setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
        setRunScopePlan({ mode: targetIds.size === 1 ? 'single' : 'feature', targetCaseIds: [...targetIds], impactCaseIds: [] });
        setRun(null);
        clearImpactCandidates();
    };
    return {
        selectedModuleKeys, selectedPageRouteKeys, runScopePlan, setRunScopePlan,
        impactCandidates, impactCandidateSelection, setImpactCandidateSelection,
        selectedCases, selectedCaseIds, selectedCaseIdSet, selectedCaseCount, runnableCaseCount,
        plannedTargets, plannedImpacts, effectiveScopePlan, moduleOptions, pageEntryOptions,
        unassignedPageCaseCount, selectedPageCaseCount, setCaseSelection,
        toggleModuleSelection, togglePageRouteSelection, applyModuleSelection, applyPageSelection,
        toggleCaseSelection, selectOnlyCase, analyzeRelatedCases, addSelectedImpactCases, clearImpactCases,
    };
}
