import type { Run, RunListItem } from '../types';
import { recoveryStageLabel, runOutcomeLabels, runScopeLabels } from '../presentation';

export function RunHistoryPanel({ run, items, loadingId, onOpenRun, onShowRecovery }: {
  run: Run | null;
  items: RunListItem[];
  loadingId: string;
  onOpenRun: (item: RunListItem) => void;
  onShowRecovery: (item: RunListItem) => void;
}) {
  const renderItem = (item: RunListItem) => {
    const scope = item.scopePlan;
    const scopeDetail = scope ? `直接目标 ${scope.targetCaseIds.length} 条 · 关联影响 ${scope.impactCaseIds.length} 条` : '历史记录未标注目标/影响范围';
    const targetNames = scope?.targetCaseIds.map(id => item.caseTitles?.[id] ?? id) ?? [];
    const impactNames = scope?.impactCaseIds.map(id => item.caseTitles?.[id] ?? id) ?? [];
    const conciseNames = (names: string[]) => `${names.slice(0, 2).join('、') || '无'}${names.length > 2 ? ` 等 ${names.length} 项` : ''}`;
    const namedScope = scope ? `目标：${conciseNames(targetNames)} · 影响：${conciseNames(impactNames)}` : '';
    const baselineDetail = item.baselineRunId
      ? `基线 ${item.baselineSiteVersionSnapshot ? `${item.baselineSiteVersionSnapshot.environment} · ${item.baselineSiteVersionSnapshot.label}` : item.baselineRunId.slice(0, 8)}${item.baselineEnvironmentComparison === 'different' ? ' · 跨环境' : item.baselineEnvironmentComparison === 'unknown' ? ' · 环境未知' : ''}${item.baselineRunModeComparison === 'different' ? ' · 测试方式不同' : item.baselineRunModeComparison === 'unknown' ? ' · 测试方式未知' : ''}`
      : '';
    const executionStateLabel = item.executionState === 'running' ? '运行中' : item.executionState === 'failed' ? '运行失败' : item.executionState === 'interrupted' ? '运行中断' : '';
    const resultCounts = item.resultCounts ?? {};
    const recordedResults = item.recordedCaseCount === undefined ? '' : ` · 已记录 ${item.recordedCaseCount}/${item.selectedCaseCount} 条结果（通过 ${resultCounts.passed ?? 0}、失败 ${resultCounts.failed ?? 0}、阻塞 ${resultCounts.blocked ?? 0}）`;
    return <article className={run?.id === item.id ? 'current' : ''} key={item.id} aria-current={run?.id === item.id ? 'true' : undefined}>
      <div><strong>{executionStateLabel ? `${executionStateLabel} · ` : ''}{item.parentRunId ? '定向重测 · ' : ''}{scope ? runScopeLabels[scope.mode] : '旧版运行'} · {executionStateLabel ? recoveryStageLabel[item.stage ?? 'starting'] : runOutcomeLabels[item.overall] ?? item.overall}</strong><span>{item.siteVersionSnapshot ? `${item.siteVersionSnapshot.environment} · ${item.siteVersionSnapshot.label}` : '未登记网站版本'} · {new Date(item.startedAt).toLocaleString()}</span><small>{scopeDetail}{namedScope ? ` · ${namedScope}` : ''}{item.parentRunId ? ` · 父运行 ${item.parentRunId.slice(0, 8)}` : ''}{baselineDetail ? ` · ${baselineDetail}` : ''} · 本轮 {item.selectedCaseCount}/{item.totalCases} 条{item.baselineEligible ? ' · 可作比较基线' : ''}{recordedResults}</small>{item.lastError && <small className="doc-run-history-error">收尾错误：{item.lastError}</small>}</div>
      {executionStateLabel ? <button className="button-secondary" disabled={Boolean(loadingId)} onClick={() => onShowRecovery(item)}>{item.canFinalizePackage ? '查看打包恢复' : '查看运行状态'}</button> : <button className="button-secondary" disabled={Boolean(loadingId)} onClick={() => onOpenRun(item)}>{loadingId === item.id ? '读取中…' : run?.id === item.id ? '当前结果' : '查看结果'}</button>}
    </article>;
  };

  return <section className="doc-run-history" id="doc-run-history">
    <div className="doc-section-head"><div><h2>运行记录</h2><p>按网站版本和本轮范围回看历史结果；也可打开报告核对旧版本证据。</p></div><span className="table-status status-running">{items.length} 轮</span></div>
    {items.length === 0 ? <p className="doc-run-history-empty">当前项目还没有运行记录。启动一轮后，版本、执行范围和结果会保存在这里。</p> : <>
      <div className="doc-run-history-list">{items.slice(0, 3).map(renderItem)}</div>
      {items.length > 3 && <details className="doc-run-history-older"><summary>更早运行 · {items.length - 3} 轮</summary><div className="doc-run-history-list">{items.slice(3).map(renderItem)}</div></details>}
    </>}
  </section>;
}
