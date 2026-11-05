import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { request } from '../api/client';
import type { ImpactAnalysis, Project } from '../types';
export function useDocumentChangeImpact(options: {
    project: Project | undefined;
    setProjects: Dispatch<SetStateAction<Project[]>>;
    setRun: Dispatch<SetStateAction<import('../types').Run | null>>;
    setMessage(message: string): void;
    setError(message: string): void;
    setBusy(busy: boolean): void;
    setTargetUrl(targetUrl: string): void;
}) {
    const { project } = options;
    const [siteVersionId, setSiteVersionId] = useState('');
    const [siteVersionLabel, setSiteVersionLabel] = useState('');
    const [siteVersionEnvironment, setSiteVersionEnvironment] = useState('主环境');
    const [siteVersionTargetUrl, setSiteVersionTargetUrl] = useState('');
    const [siteVersionChangeNotes, setSiteVersionChangeNotes] = useState('');
    const [impactAnalysisId, setImpactAnalysisId] = useState('');
    const [impactSelectedCaseIds, setImpactSelectedCaseIds] = useState<string[]>([]);
    const [impactReviewNotes, setImpactReviewNotes] = useState('');
    const selectedSiteVersion = project?.siteVersions?.find(item => item.id === siteVersionId)
        ?? project?.siteVersions?.find(item => item.id === project.activeSiteVersionId)
        ?? project?.siteVersions?.at(-1);
    const selectedImpactAnalysis = selectedSiteVersion
        ? project?.impactAnalyses?.find(item => item.id === impactAnalysisId && item.siteVersionId === selectedSiteVersion.id)
            ?? [...(project?.impactAnalyses ?? [])].reverse().find(item => item.siteVersionId === selectedSiteVersion.id)
        : undefined;
    useEffect(() => {
        if (!selectedImpactAnalysis) {
            setImpactAnalysisId('');
            setImpactSelectedCaseIds([]);
            setImpactReviewNotes('');
            return;
        }
        setImpactAnalysisId(selectedImpactAnalysis.id);
        setImpactSelectedCaseIds(selectedImpactAnalysis.status === 'pending'
            ? selectedImpactAnalysis.suggestions.map(item => item.caseId)
            : selectedImpactAnalysis.selectedCaseIds ?? []);
        setImpactReviewNotes(selectedImpactAnalysis.reviewNotes ?? '');
    }, [project?.id, selectedSiteVersion?.id, selectedImpactAnalysis?.id]);
    const registerSiteVersion = async () => {
        if (!project)
            return;
        options.setBusy(true);
        options.setError('');
        options.setMessage('');
        try {
            const updated = await request<Project>('/api/document-projects/' + project.id + '/site-versions', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ label: siteVersionLabel, environment: siteVersionEnvironment, targetUrl: siteVersionTargetUrl, changeNotes: siteVersionChangeNotes }),
            });
            const version = updated.siteVersions?.find(item => item.id === updated.activeSiteVersionId) ?? updated.siteVersions?.at(-1);
            options.setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
            setSiteVersionId(version?.id ?? '');
            options.setTargetUrl(updated.targetUrl);
            setSiteVersionTargetUrl(version?.targetUrl ?? updated.targetUrl);
            setSiteVersionLabel('');
            setSiteVersionChangeNotes('');
            options.setRun(null);
            options.setMessage(version ? '已登记网站版本“' + version.label + '”，后续运行会固定记录此版本。' : '网站版本已登记。');
        }
        catch (error) {
            options.setError((error as Error).message);
        }
        finally {
            options.setBusy(false);
        }
    };
    const analyzeIterationImpact = async () => {
        if (!project || !selectedSiteVersion)
            return;
        options.setBusy(true);
        options.setError('');
        options.setMessage('正在根据本次迭代说明匹配已有用例…');
        try {
            const result = await request<{
                project: Project;
                analysis: ImpactAnalysis;
            }>('/api/document-projects/' + project.id + '/impact-reviews', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'analyze', siteVersionId: selectedSiteVersion.id }),
            });
            options.setProjects(rows => rows.map(item => item.id === project.id ? { ...item, impactAnalyses: result.project.impactAnalyses } : item));
            setImpactAnalysisId(result.analysis.id);
            setImpactSelectedCaseIds(result.analysis.suggestions.map(item => item.caseId));
            setImpactReviewNotes('');
            options.setMessage('已生成 ' + result.analysis.suggestions.length + ' 条待人工核对的候选用例；关键词匹配不等于语义判断。');
        }
        catch (error) {
            options.setError((error as Error).message);
            options.setMessage('');
        }
        finally {
            options.setBusy(false);
        }
    };
    const reviewIterationImpact = async (decision: 'accept' | 'reject') => {
        if (!project || !selectedImpactAnalysis)
            return;
        if (decision === 'accept' && !impactSelectedCaseIds.length) {
            options.setError('请至少选择一条要确认的用例；没有受影响用例时可以拒绝建议。');
            return;
        }
        options.setBusy(true);
        options.setError('');
        options.setMessage('');
        try {
            const result = await request<{
                project: Project;
                analysis: ImpactAnalysis;
            }>('/api/document-projects/' + project.id + '/impact-reviews', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'review', analysisId: selectedImpactAnalysis.id, decision, ...(decision === 'accept' ? { selectedCaseIds: impactSelectedCaseIds } : {}), ...(impactReviewNotes.trim() ? { notes: impactReviewNotes.trim() } : {}) }),
            });
            options.setProjects(rows => rows.map(item => item.id === project.id ? { ...item, impactAnalyses: result.project.impactAnalyses } : item));
            setImpactAnalysisId(result.analysis.id);
            setImpactSelectedCaseIds(result.analysis.selectedCaseIds ?? []);
            options.setMessage(decision === 'accept'
                ? '已确认影响范围。用例和本轮执行范围尚未更改；如需纳入本轮，请单独选择加入。'
                : '已拒绝这组影响建议，记录已保留。');
        }
        catch (error) {
            options.setError((error as Error).message);
        }
        finally {
            options.setBusy(false);
        }
    };
    return {
        setSiteVersionId, siteVersionLabel, setSiteVersionLabel,
        siteVersionEnvironment, setSiteVersionEnvironment, siteVersionTargetUrl, setSiteVersionTargetUrl,
        siteVersionChangeNotes, setSiteVersionChangeNotes, impactSelectedCaseIds, setImpactSelectedCaseIds,
        impactReviewNotes, setImpactReviewNotes, selectedSiteVersion, selectedImpactAnalysis,
        registerSiteVersion, analyzeIterationImpact, reviewIterationImpact,
    };
}
