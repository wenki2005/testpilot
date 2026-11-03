import React from 'react';
import type { Run } from '../types';
import { CaseCodeViewer } from './CaseCodeViewer';

export function DailyRunOutcome({ run, busy, onRetry, canRetry }: { run: Run; busy: boolean; onRetry(): void; canRetry: boolean }) {
  const results = run.deterministic.results;
  const issues = [...results.map(item => ({ ...item, laneLabel: '脚本' })),
    ...(run.runMode === 'compare' ? (run.ai?.results ?? []).map(item => ({ ...item, laneLabel: '视觉' })) : [])]
    .filter(item => item.status !== 'passed' && item.status !== 'not-applicable');
  const count = (status: string) => results.filter(item => item.status === status).length;
  const outcome = run.overall === 'passed' ? '本次测试通过' : run.overall === 'cancelled' ? '本次测试已停止' : run.overall === 'failed' ? '本次发现问题' : '本次有未验证项';
  return <React.Fragment><section className="daily-outcome" id="doc-results" aria-label="本次测试结果">
    <div className="daily-outcome-heading"><div><h2>{outcome}</h2><p>脚本结果：通过 {count('passed')} · 失败 {count('failed')} · 阻塞 {count('blocked')} · 取消 {count('cancelled')}</p></div>
      <a className="button-secondary" href={`/api/document-runs/${encodeURIComponent(run.id)}/report`}>下载报告</a></div>
    <p className="daily-outcome-scope">本轮执行 {run.caseScope?.selectedCaseIds.length ?? results.length}/{run.caseScope?.totalCases ?? results.length} 条。未执行的用例不计为通过。{run.runMode === 'compare' ? '这是对照运行；完整通道结果见下方更多结果工具。' : ''}</p>
    {issues.length > 0 && <div className="daily-issue-list">{issues.map(item => {
      const snapshot = run.executionCaseSnapshots?.find(c => c.id === item.id);
      const evidence = run.evidence?.filter(e => e.caseId === item.id) ?? [];
      return <article key={`${item.laneLabel}:${item.id}`}><h3>{item.title} <small>{item.id} · {item.laneLabel} · {item.status === 'failed' ? '失败' : item.status === 'blocked' ? '阻塞' : item.status}</small></h3>
        <p>{item.detail}</p><div className="daily-issue-actions">{evidence.filter(e => e.type === 'screenshot').map((e,i) => <a key={e.evidenceId} href={`/api/document-runs/${encodeURIComponent(run.id)}/evidence/${encodeURIComponent(e.evidenceId)}`} target="_blank" rel="noreferrer">查看截图{evidence.filter(e=>e.type==='screenshot').length > 1 ? ` ${i+1}` : ''}</a>)}
        {!evidence.some(e => e.type === 'screenshot') && <span>{evidence.some(e => e.type === 'unavailable' && /timeout|超时/iu.test(e.reason)) ? '截图未保存：采集超时。原失败记录仍保留。' : '本条没有可用截图'}</span>}
        <details><summary>查看测试步骤</summary><pre>{snapshot?.steps?.length ? JSON.stringify(snapshot.steps,null,2) : '本轮没有保存可查看的步骤快照。'}</pre></details><CaseCodeViewer key={`${run.id}:${item.id}`} caseId={item.id} title={item.title} runId={run.id} /></div></article>;
    })}</div>}
    {issues.length > 0 && canRetry && <button className="button-secondary" disabled={busy} onClick={onRetry}>重跑未通过的测试</button>}
    <details className="daily-passed"><summary>查看全部 {results.length} 条结果</summary><ul>{results.map(item => <li key={item.id}>{item.status === 'passed' ? '通过' : item.status === 'failed' ? '失败' : item.status} · {item.title} <small>{item.id}</small><CaseCodeViewer key={`${run.id}:${item.id}`} caseId={item.id} title={item.title} runId={run.id} /></li>)}</ul></details>
    <div className="daily-result-footer"><small>运行编号：{run.id}</small>{run.packageReady && <a href={`/api/document-runs/${encodeURIComponent(run.id)}/package`}>下载测试脚本</a>}</div>
  </section></React.Fragment>;
}
