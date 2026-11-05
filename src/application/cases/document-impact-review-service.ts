import type { DocumentImpactAnalysis, DocumentProject } from '../../domain/documents/shared/test-model.js';
import type { DocumentProjectRepository } from '../ports/document-project-repository.js';
export type DocumentImpactReviewErrorCode = 'not-found' | 'invalid-request' | 'missing-version' | 'missing-change-notes' | 'limit-reached' | 'review-not-found' | 'already-reviewed' | 'stale-review' | 'unknown-cases';
export class DocumentImpactReviewError extends Error {
    constructor(readonly code: DocumentImpactReviewErrorCode, message: string) { super(message); }
}
export type DocumentImpactReviewResult = {
    action: 'analyze';
    project: DocumentProject;
    analysis: DocumentImpactAnalysis;
} | {
    action: 'review';
    project: DocumentProject;
    analysis: DocumentImpactAnalysis;
};
export function createDocumentImpactReviewService(deps: {
    projects: Pick<DocumentProjectRepository, 'getProject' | 'saveProject'>;
    analyze(cases: DocumentProject['cases'], changeNotes: string): Pick<DocumentImpactAnalysis, 'matchingMethod' | 'suggestions' | 'unmatchedTerms'>;
    getCaseVersion(project: DocumentProject): string;
    newId(): string;
    now(): string;
}) {
    return {
        async execute(projectId: string, input: unknown): Promise<DocumentImpactReviewResult> {
            const project = await deps.projects.getProject(projectId);
            if (!project)
                throw new DocumentImpactReviewError('not-found', '文档测试项目不存在。');
            const data = input as Record<string, unknown> | null;
            if (!data || typeof data !== 'object' || Array.isArray(data) || !['analyze', 'review'].includes(String(data.action))) {
                throw new DocumentImpactReviewError('invalid-request', '变更影响操作必须是 analyze 或 review。');
            }
            if (data.action === 'analyze') {
                if (Object.keys(data).some(key => !['action', 'siteVersionId'].includes(key)) || typeof data.siteVersionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.siteVersionId)) {
                    throw new DocumentImpactReviewError('invalid-request', '影响分析需要有效的网站版本 ID。');
                }
                const siteVersion = project.siteVersions?.find(item => item.id === data.siteVersionId);
                if (!siteVersion)
                    throw new DocumentImpactReviewError('missing-version', '网站版本不存在或不属于当前项目。');
                if (!siteVersion.changeNotes.trim())
                    throw new DocumentImpactReviewError('missing-change-notes', '该网站版本没有迭代说明；请先登记可审核的变更说明。');
                const analyses = project.impactAnalyses ?? [];
                if (analyses.length >= 100)
                    throw new DocumentImpactReviewError('limit-reached', '单个项目最多保留 100 次变更影响审核记录。');
                const analysis: DocumentImpactAnalysis = {
                    id: deps.newId(), siteVersionId: siteVersion.id, siteVersionLabel: siteVersion.label,
                    changeNotesSnapshot: siteVersion.changeNotes, caseVersion: deps.getCaseVersion(project), analyzedAt: deps.now(),
                    ...deps.analyze(project.cases, siteVersion.changeNotes), status: 'pending',
                };
                project.impactAnalyses = [...analyses, analysis];
                project.updatedAt = deps.now();
                await deps.projects.saveProject(project);
                return { action: 'analyze', project, analysis };
            }
            if (Object.keys(data).some(key => !['action', 'analysisId', 'decision', 'selectedCaseIds', 'notes'].includes(key)) ||
                typeof data.analysisId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.analysisId) ||
                !['accept', 'reject'].includes(String(data.decision)) ||
                data.notes !== undefined && (typeof data.notes !== 'string' || data.notes.length > 1000) ||
                data.decision === 'accept' && (!Array.isArray(data.selectedCaseIds) || !data.selectedCaseIds.length || data.selectedCaseIds.length > 200 || data.selectedCaseIds.some(id => typeof id !== 'string') || new Set(data.selectedCaseIds).size !== data.selectedCaseIds.length) ||
                data.decision === 'reject' && data.selectedCaseIds !== undefined && (!Array.isArray(data.selectedCaseIds) || data.selectedCaseIds.length > 0)) {
                throw new DocumentImpactReviewError('invalid-request', '审核需要 analysisId、accept/reject、审核说明，以及 accept 时明确选择的用例 ID。');
            }
            const reviews = project.impactAnalyses ?? [];
            const index = reviews.findIndex(item => item.id === data.analysisId);
            if (index < 0)
                throw new DocumentImpactReviewError('review-not-found', '变更影响分析记录不存在。');
            const review = reviews[index]!;
            if (review.status !== 'pending')
                throw new DocumentImpactReviewError('already-reviewed', '该影响建议已审核；如需修改选择，请重新分析后创建一条新记录。');
            if (review.caseVersion !== deps.getCaseVersion(project))
                throw new DocumentImpactReviewError('stale-review', '分析后测试用例已发生变化；请重新分析，避免审核过期的影响建议。');
            const selectedCaseIds: string[] = data.decision === 'accept' ? data.selectedCaseIds as string[] : [];
            const known = new Set(project.cases.map(item => item.id));
            const unknown = selectedCaseIds.filter(id => !known.has(id));
            if (unknown.length)
                throw new DocumentImpactReviewError('unknown-cases', `审核范围包含不存在的用例：${unknown.join(', ')}`);
            const updatedReview: DocumentImpactAnalysis = {
                ...review,
                status: data.decision === 'accept' ? 'accepted' : 'rejected',
                selectedCaseIds,
                ...(typeof data.notes === 'string' && data.notes.trim() ? { reviewNotes: data.notes.trim() } : {}),
                reviewedAt: deps.now(),
            };
            project.impactAnalyses = reviews.map((item, itemIndex) => itemIndex === index ? updatedReview : item);
            project.updatedAt = deps.now();
            await deps.projects.saveProject(project);
            return { action: 'review', project, analysis: updatedReview };
        },
    };
}
