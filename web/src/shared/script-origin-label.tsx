import React, { type ReactNode } from 'react';
export function ProjectScriptOriginLabel({ origin, children }: {
    origin: string;
    children?: ReactNode;
}) {
    const label = origin === 'source-agent-candidate' ? '源码测试 Agent 候选（来源待审）'
        : origin === 'ai-requirement-candidate' ? 'AI 需求候选（受限 Playwright DSL）'
            : '人工维护的注册 profile 快照';
    return <span data-origin={origin}>{label}{children}</span>;
}
export interface SourceProvenanceViewModel {
    runId: string;
    candidateDigest: string;
    runtimeConclusion: string;
    assessmentSummary?: string;
    blockers?: string[];
    executions: Array<{
        id: string;
        status: string;
        files: string[];
        evidenceId: string;
    }>;
    evidenceIds: string[];
    findings: Array<{
        caseId: string;
        status: string;
        evidenceDescription: string;
        evidenceRefs: string[];
        evidenceLinkStatus: 'linked' | 'unlinked-pending-review';
    }>;
}
export function SourceProvenanceReview({ provenance }: {
    provenance: SourceProvenanceViewModel;
}) {
    return <React.Fragment><div className="script-diff source-provenance"><strong>源码测试 Agent 来源与执行证据（待人工审核）</strong><p>来源 run：<code>{provenance.runId}</code> · 候选摘要：<code>{provenance.candidateDigest}</code> · 执行结论：{provenance.runtimeConclusion}</p><h4>AI 评估摘要</h4><p>{provenance.assessmentSummary || '旧版版本未保留评估摘要，请审核者自行核对现有证据。'}</p>{!!provenance.blockers?.length && <><h4>未解决事项</h4><ul>{provenance.blockers.map((item, index) => <li key={index}>{item}</li>)}</ul></>}<ul>{provenance.executions.map(execution => <li key={execution.id}>{execution.id} · {execution.status} · 文件：{execution.files.join(', ')} · 证据：{execution.evidenceId}</li>)}</ul><p>证据 ID：{provenance.evidenceIds.join(', ') || '无'}</p>{provenance.findings.map((finding, index) => <div key={`${finding.caseId}-${index}`}><strong>{finding.caseId} · {finding.status} · {finding.evidenceLinkStatus === 'linked' ? `已核验引用：${finding.evidenceRefs.join(', ')}` : '未关联待审'}</strong><p>{finding.evidenceDescription}</p></div>)}</div></React.Fragment>;
}
