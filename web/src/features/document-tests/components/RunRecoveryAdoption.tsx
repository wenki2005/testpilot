import React from 'react';
import type { AdoptedRecoveryAdvice } from '../types';

/** Displays the frozen source of a human recovery attempt, independently of newer investigations. */
export function RunRecoveryAdoption({ adoption, automatic }: { adoption?: AdoptedRecoveryAdvice; automatic?: boolean }) {
  if (!adoption) return null;
  if (typeof adoption.recordId !== 'string' || typeof adoption.caseId !== 'string' || typeof adoption.summary !== 'string'
    || typeof adoption.runDigest !== 'string' || typeof adoption.adoptedAt !== 'string' || !Array.isArray(adoption.evidence)) {
    return <p>本次恢复包含无法核验的历史建议记录，请检查原运行资料。</p>;
  }
  return <React.Fragment><details className="doc-recovery-advice">
    <summary>本次恢复采纳的调查建议</summary>
    <p>用例：{adoption.caseId} · 采纳时间：{adoption.adoptedAt}</p>
    <p>{adoption.summary}</p>
    <p>{automatic ? '这是自动恢复策略 v1 的单次尝试来源记录。' : '这是本次人工恢复的来源记录。'}建议仍待验证，恢复结果以本轮实际执行为准。</p>
    <p>调查记录：{adoption.recordId}</p>
    <p>事实摘要：{adoption.runDigest}</p>
    <ul>{adoption.evidence.filter(ref => ref && typeof ref.factId === 'string' && typeof ref.quote === 'string').map((ref, index) => <li key={`${ref.factId}-${index}`}>{ref.factId}：<q>{ref.quote}</q></li>)}</ul>
  </details></React.Fragment>;
}
