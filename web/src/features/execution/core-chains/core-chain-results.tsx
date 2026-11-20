import { useMemo, useState } from 'react';
import type { CoreChain, CoreRun, CoreStatus } from '../../../../../src/domain/regression/core-chain-definitions';
import Modal from '../../shared/modal';
import CaseEvidenceDialog from '../../shared/case-evidence-dialog';
const names: Record<CoreStatus, string> = { passed: '通过', failed: '失败', blocked: '阻塞', not_executed: '未执行' };
const evidenceRoot = (location.pathname.startsWith('/dify/') ? '/dify' : '') + '/api/system-module-regression/core-chains';
type StepView = {
    id: string;
    title: string;
    expected: string;
    caseIds: string[];
    status?: CoreStatus;
    detail?: string;
    finishedAt?: string;
    evidence?: string;
    references?: string[];
    sources?: Array<{ caseId: string; title: string; expected?: string }>;
};
/** 核心链路「查看用例」：与「全部用例」同款弹窗，步骤按 1、2、3… 标出执行顺序。 */
export default function CoreChainResults({ chainId, definitions, run, onClose }: {
    chainId: string;
    definitions: CoreChain[];
    run?: CoreRun;
    onClose: () => void;
}) {
    const [shot, setShot] = useState<{ cases: Array<{ id: string; title: string; status: string; moduleName?: string; at?: string | number; detail?: string; evidenceUrl?: string }>; index: number } | null>(null);
    const chain = definitions.find(c => c.id === chainId);
    const actual = run?.chains.find(c => c.id === chainId);
    const steps = ((actual?.steps ?? chain?.steps ?? []) as StepView[]);
    const counts = useMemo(() => {
        const total: Record<CoreStatus, number> = { passed: 0, failed: 0, blocked: 0, not_executed: 0 };
        for (const step of steps)
            total[step.status ?? 'not_executed']++;
        return total;
    }, [steps]);
    const statusOf = (step: StepView) => step.status ?? 'not_executed';
    // 执行器会把结构化读取结果（申请编号、审批人）附在 detail 末尾；这里只展示人能读的句子。
    const readable = (detail?: string) => (detail ?? '').replace(/[；;]?\s*读取：\{[^}]*\}/gu, '').trim();
    const openShots = (step: StepView) => {
        const list = steps.filter(s => s.evidence && run).map(s => ({
            id: s.id,
            title: s.title,
            status: statusOf(s),
            moduleName: chain?.title ?? '',
            at: run?.createdAt ?? 0,
            detail: s.detail ?? '',
            evidenceUrl: `${evidenceRoot}/runs/${run!.id}/evidence/${s.evidence}`,
        }));
        return { cases: list, index: Math.max(0, list.findIndex(x => x.id === step.id)) };
    };
    if (!chain)
        return null;
    return <Modal title={chain.title} onClose={onClose} className="core-steps">
    <div className="sm-heading"><strong>{steps.length} 个步骤</strong></div>
    <div className="sm-case-toolbar">{(Object.keys(names) as CoreStatus[]).filter(status => counts[status] > 0).map(status => <span key={status} className={'sm-badge sm-' + status}>{counts[status]} {names[status]}</span>)}</div>
    <div className="sm-pack-cases">
      {steps.map(step => {
            const status = statusOf(step), index = steps.indexOf(step) + 1;
            return <div className="sm-pack-row" key={step.id}>
          <span className={'core-step-no' + (status === 'passed' ? ' is-passed' : status === 'failed' ? ' is-failed' : '')}>{index}</span>
          <details>
            <summary>{step.title}</summary>
            <h4>预期结果</h4>
            <p>{step.expected}</p>
            <h4>实际结果</h4>
            <p>{readable(step.detail) || '该步骤在所选批次中未执行。'}</p>
            {step.finishedAt && <p>执行时间：{new Date(step.finishedAt).toLocaleString('zh-CN')}</p>}
            {step.references?.length ? <p>关联申请：{step.references.join('、')}</p> : null}
            {step.evidence && run && <p><button type="button" className="sm-link" onClick={() => setShot(openShots(step))}>查看截图</button></p>}
            <h4>关联原用例</h4>
            <p>{step.caseIds.join('、')}{step.sources?.length ? ' · ' + step.sources.map(source => source.title).join('；') : ''}</p>
          </details>
          <span className={'sm-badge sm-' + status}>{names[status]}</span>
        </div>;
        })}
    </div>
    <footer className="sm-case-footer"><span>共 {steps.length} 个步骤 · 通过 {counts.passed} · 失败 {counts.failed} · 阻塞 {counts.blocked} · 未执行 {counts.not_executed}</span><button className="sm-primary" onClick={onClose}>关闭</button></footer>
    {shot && <CaseEvidenceDialog cases={shot.cases} index={shot.index} onChange={index => setShot({ ...shot, index })} onClose={() => setShot(null)}/>}
  </Modal>;
}
