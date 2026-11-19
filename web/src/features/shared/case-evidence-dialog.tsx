import { useEffect } from 'react';
import './case-evidence-dialog.css';

export type EvidenceCase = {
  id: string;
  title: string;
  status: string;
  moduleName?: string;
  at?: string | number;
  detail?: string;
  evidenceUrl?: string;
};

const statusLabels: Record<string, string> = {
  passed: '通过',
  failed: '失败',
  blocked: '阻塞',
  error: '异常',
  not_executed: '未执行',
};

/**
 * One dialog for every "look at the failure screenshot" entry point.
 * Execution results and project status share the same markup so the interaction
 * never jumps to a separate page or tab.
 */
export default function CaseEvidenceDialog({ cases, index, onChange, onClose, reasonLabel = '失败原因' }: {
  cases: EvidenceCase[];
  index: number;
  onChange: (next: number) => void;
  onClose: () => void;
  reasonLabel?: string;
}) {
  const row = cases[index];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && index > 0) onChange(index - 1);
      if (event.key === 'ArrowRight' && index < cases.length - 1) onChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cases.length, index, onChange, onClose]);
  if (!row) return null;
  return <div className="ced-mask" role="presentation" onClick={onClose}>
    <div className="ced-modal" role="dialog" aria-label="用例截图详情" onClick={event => event.stopPropagation()}>
      <header><h3>{row.id.replace(/^xmind-/, '')} {row.title}</h3><button type="button" className="ced-close" onClick={onClose}>关闭</button></header>
      <div className="ced-body">
        <div className="ced-kv">
          <b>状态</b><span><span className={`ced-tag ced-${row.status}`}>{statusLabels[row.status] ?? row.status}</span></span>
          <b>模块</b><span>{row.moduleName ?? '—'}</span>
          <b>执行时间</b><span>{row.at ? new Date(row.at).toLocaleString('zh-CN') : '—'}</span>
        </div>
        <div className={'ced-reason ced-reason-' + row.status}><b>{row.status === 'passed' ? '通过结果' : row.status === 'blocked' ? '阻塞原因' : reasonLabel}</b><br/>{row.status === 'passed' ? '通过' : (row.detail ?? '—')}</div>
        {row.evidenceUrl
          ? <img className="ced-shot" alt="执行截图" src={row.evidenceUrl}/>
          : <div className="ced-shot ced-shot-empty">这条没有截图</div>}
      </div>
      <footer>
        <button type="button" className="ced-step" disabled={index <= 0} onClick={() => onChange(index - 1)}>◀ 上一条</button>
        <span>{index + 1} / {cases.length}</span>
        <button type="button" className="ced-step ced-next" disabled={index >= cases.length - 1} onClick={() => onChange(index + 1)}>下一条 ▶</button>
      </footer>
    </div>
  </div>;
}
