import { CaseCodeViewer } from './CaseCodeViewer';
import type { BaselineComparison, BaselineScopeGroup, Comparison, Project, Run } from '../types';
import { baselineDispositionLabels, baselineScopeGroup, baselineScopeGroupLabels, baselineStatusLabels, categoryOptions, triageLabels } from '../presentation';
import { Lane } from './Lane';
import { RunNotificationStatus } from './RunNotificationStatus';
import { RunInvestigation } from './RunInvestigation';
import { RunRecoveryReadiness } from './RunRecoveryReadiness';
import { RunRecoveryAdoption } from './RunRecoveryAdoption';
import { RunAutomaticRecovery } from './RunAutomaticRecovery';
export function RunResultsPanel({ run, project, busy, retestCaseIds, onRetestUnresolved, onRetryCheckpoint, onProjectChanged, sectionId = 'doc-results' }: {
    sectionId?: string;
    run: Run;
    project?: Project;
    busy: boolean;
    retestCaseIds: string[];
    onRetestUnresolved: () => void;
    onRetryCheckpoint?: (caseId: string, stepIndex: number, adviceRecordId?: string) => void;
    onProjectChanged?: () => void;
}) {
    const renderComparison = (item: Comparison) => {
        const scopeLabel = run.scopePlan
            ? run.scopePlan.targetCaseIds.includes(item.id) ? '直接目标' : run.scopePlan.impactCaseIds.includes(item.id) ? '关联影响' : run.scopePlan.prerequisiteCaseIds?.includes(item.id) ? '自动前置' : '范围未分类'
            : run.caseScopeKnown === false ? '历史范围未标注' : '目标/影响未标注';
        const scopeTone = scopeLabel === '直接目标' ? 'target' : scopeLabel === '关联影响' ? 'impact' : 'unknown';
        const failed = item.deterministic === 'failed' || item.apiContract === 'failed';
        const unresolved = item.resolution === 'unresolved';
        const mismatch = item.resolution === 'mismatch';
        const impactReasons = run.scopePlan?.impactReasons?.[item.id] ?? [];
        const frozenCase = run.executionCaseSnapshots?.find(candidate => candidate.id === item.id);
        const caseEvidence = run.evidence?.filter(evidence => evidence.caseId === item.id) ?? [];
        const cancelled = item.deterministic === 'cancelled' || item.computerUse === 'cancelled' || item.apiContract === 'cancelled';
        const notRun = item.deterministic === 'not-run' || item.computerUse === 'not-run' || item.apiContract === 'not-run';
        const resultLabel = cancelled ? 'Ⅱ 已取消'
            : notRun ? '— 未运行'
                : unresolved ? '! 未验证'
                    : mismatch ? '⚠ 结果不一致'
                        : failed ? '× 回归失败'
                            : item.resolution === 'not-applicable' ? '— N/A'
                                : run.runMode === 'regression' ? '✓ 通过'
                                    : item.aligned ? '✓ 已对齐' : '! 待处理';
        const resultClass = cancelled || notRun || item.resolution === 'not-applicable'
            ? ''
            : item.aligned && !failed && !mismatch && !unresolved ? 'aligned' : 'mismatch';
        return <article key={item.id} className={`doc-comparison ${resultClass}`}>
      <strong>{resultLabel} · <span className={`doc-run-scope-badge ${scopeTone}`}>{scopeLabel}</span> · {item.title} ({item.id})</strong>
      <p>脚本：{item.deterministic}{run.runMode !== 'regression' ? `　Computer Use：${item.computerUse}` : ''}</p>
      {impactReasons.length > 0 && <small className="doc-impact-run-reason">关联影响依据：{impactReasons.join('；')}</small>}
      <CaseCodeViewer key={`${run.id}:${item.id}`} runId={run.id} caseId={item.id} title={item.title}/>
      {frozenCase && <details className="doc-frozen-case"><summary>查看本轮冻结步骤（{frozenCase.steps.length} 步）</summary><p>来源：运行快照 · 用例 {frozenCase.id} · 版本摘要 {run.caseVersion?.slice(0, 16) ?? '旧记录未保存'}。该 DSL 由受限 BrowserStep 解释器执行。</p><pre>{JSON.stringify(frozenCase.steps, null, 2)}</pre></details>}
      {caseEvidence.map(evidence => evidence.type === 'screenshot'
                ? <a className="doc-case-evidence" href={`/api/document-runs/${encodeURIComponent(run.id)}/evidence/${encodeURIComponent(evidence.evidenceId)}`} target="_blank" rel="noreferrer" key={evidence.evidenceId}><img src={`/api/document-runs/${encodeURIComponent(run.id)}/evidence/${encodeURIComponent(evidence.evidenceId)}`} alt={`${item.title} · ${evidence.reason}`}/><small>步骤 {evidence.stepIndex === undefined ? '未定位' : evidence.stepIndex + 1} · {evidence.reason} · SHA-256 {evidence.sha256?.slice(0, 12)}</small></a>
                : <small className="doc-evidence-unavailable" key={evidence.evidenceId}>截图不可用：{evidence.reason}</small>)}
      {item.issue && <small>{item.issue} 编辑脚本 / 预期后重新审核并重跑。</small>}
      {item.triage && <small className="doc-triage">初步归类：{triageLabels[item.triage.category]}（{item.triage.confidence === 'evidence-based' ? '有直接证据' : '需复核'}） · {item.triage.detail}</small>}
      {(failed || mismatch || unresolved) && item.nextAction && <p className="doc-next-action"><strong>下一步可执行动作：</strong>{item.nextAction}</p>}
    </article>;
    };
    const targetComparisons = run.scopePlan ? run.comparisons.filter(item => run.scopePlan!.targetCaseIds.includes(item.id)) : [];
    const impactComparisons = run.scopePlan ? run.comparisons.filter(item => run.scopePlan!.impactCaseIds.includes(item.id)) : [];
    const prerequisiteComparisons = run.scopePlan ? run.comparisons.filter(item => run.scopePlan!.prerequisiteCaseIds?.includes(item.id)) : [];
    const baselineGroupOrder: BaselineScopeGroup[] = ['target', 'impact', 'unselected', 'removed', 'unknown'];
    const baselineComparisons = run.baselineComparison ?? [];
    const baselineScopePlan = run.scopePlan;
    const baselineCaseScopeLabel = (caseId: string) => {
        const scope = run.baselineRunSnapshot?.scopePlan;
        if (!scope)
            return '旧版范围未标注';
        if (scope.targetCaseIds.includes(caseId))
            return '直接目标';
        if (scope.impactCaseIds.includes(caseId))
            return '关联影响';
        return '基线未选';
    };
    const currentBaselineCaseScopeLabel = (item: BaselineComparison) => {
        if (item.disposition === 'removed')
            return '已从当前项目移除';
        if (run.scopePlan) {
            if (run.scopePlan.targetCaseIds.includes(item.caseId))
                return '直接目标';
            if (run.scopePlan.impactCaseIds.includes(item.caseId))
                return '关联影响';
        }
        if (run.caseScope?.selectedCaseIds.includes(item.caseId))
            return '本轮已执行，范围未分类';
        if (run.caseScopeKnown === false)
            return '本轮历史范围未标注';
        if (run.caseScope?.excludedCaseIds.includes(item.caseId))
            return '本轮未选';
        return '本轮范围未知';
    };
    const baselineGroups = baselineComparisons.length ? baselineGroupOrder.map(group => ({
        group,
        label: baselineScopeGroupLabels[group],
        items: baselineComparisons.filter(item => baselineScopeGroup(item, baselineScopePlan) === group),
    })).filter(group => group.items.length > 0) : [];
    const excludedCaseIds = run.caseScope?.excludedCaseIds ?? [];
    const excludedCaseLabels = excludedCaseIds.map(id => ({ id, title: project?.cases.find(item => item.id === id)?.title ?? run.baselineComparison?.find(item => item.caseId === id)?.title ?? id }));
    return <section className="doc-run-card" id={sectionId}>
    <header><div><h2>{run.runMode === 'regression' ? '常规回归结果' : 'AI 辅助对照结果'}</h2><p>{run.overall === 'cancelled' ? '本轮已取消；部分结果已保存' : run.runMode === 'regression' ? run.overall === 'passed' ? '本轮通过' : run.overall === 'failed' ? '本轮发现失败' : '本轮存在未验证或阻塞项' : run.finalReady ? `本轮范围已对齐 · ${run.overall === 'passed' ? '用例全部通过' : '两侧一致发现失败'}` : `本轮有未对齐结果 · ${run.comparisons.filter(item => item.aligned).length}/${run.comparisons.length} 条已对齐；blocked 不代表失败或通过`}{run.caseScope ? ` · ${run.caseScopeKnown === false ? '历史范围未知' : `实际选中 ${run.caseScope.selectedCaseIds.length}/${run.caseScope.totalCases} 条`}` : ''}</p>{run.scopePlan && <small>本轮范围：{run.scopePlan.mode === 'single' ? '单项测试' : run.scopePlan.mode === 'feature' ? '功能测试' : run.scopePlan.mode === 'impact' ? run.scopePlan.targetCaseIds.length ? '功能与影响检查' : '纯影响检查' : run.scopePlan.mode === 'full' ? '全量回归' : '自定义'} · 直接目标 {run.scopePlan.targetCaseIds.length} 条 · 关联影响 {run.scopePlan.impactCaseIds.length} 条</small>}{run.siteVersionSnapshot && <small>网站版本：{run.siteVersionSnapshot.environment} · {run.siteVersionSnapshot.label} · {run.siteVersionSnapshot.targetUrl}{run.siteVersionSnapshot.changeNotes ? ` · 迭代：${run.siteVersionSnapshot.changeNotes}` : ''}</small>}{!run.siteVersionSnapshot && <small>网站版本：未登记（旧运行）</small>}{run.caseVersion && <small>用例/脚本版本：{run.caseVersion}</small>}{run.materialVersion && <small>需求/测试资料版本：{run.materialVersion}</small>}{run.testDataVersion && <small>本轮测试数据版本：{run.testDataVersion}</small>}{run.sourceMaterialsSnapshot?.map(item => <small key={item.id}>资料快照：{item.fileName} · {item.role} · SHA-256 {item.sha256}</small>)}{run.parentRunId && <small>定向重测 · 父运行 {run.parentRunId}{run.retestSelection ? ` · 本次 ${run.retestSelection.join('、')}` : ''}{run.retestNotes ? ` · ${run.retestNotes}` : ''}</small>}</div>
      <div className="doc-buttons">{retestCaseIds.length > 0 && <button className="button-secondary" disabled={busy} onClick={onRetestUnresolved}>重测失败 / 未验证项（{retestCaseIds.length}）</button>}{(run.reportReady || run.report) && <a className="button-secondary" href={`/api/document-runs/${run.id}/report`} download>{run.reportReady ? '下载本轮报告' : '下载部分运行报告'}</a>}{(run.packageReady || run.finalReady) && <a className="button-primary" href={`/api/document-runs/${run.id}/package`} download>下载可复用脚本包 ZIP</a>}</div></header>
    {run.parameterValues && Object.keys(run.parameterValues).length > 0 && <p className="doc-notice">本轮参数{run.testDataSetId ? '（数据组 ' + (project?.testDataSets?.find(item => item.id === run.testDataSetId)?.name ?? run.testDataSetId) + '）' : '（手动输入）'}：{Object.entries(run.parameterValues).map(([key, value]) => key + '=' + JSON.stringify(value)).join(' · ')}</p>}
    <RunNotificationStatus runId={run.id}/>
    <RunInvestigation runId={run.id} overall={run.overall} evidence={run.evidence ?? []} onProjectChanged={onProjectChanged}/>
    <RunRecoveryAdoption adoption={run.checkpointRecovery?.adoptedAdvice} automatic={run.checkpointRecovery?.trigger === 'automatic-policy'}/>
    <RunAutomaticRecovery runId={run.id} overall={run.overall}/>
    <RunRecoveryReadiness runId={run.id} overall={run.overall} busy={busy} onRetryCheckpoint={onRetryCheckpoint}/>
    {(!run.finalReady || (run.caseScope && run.caseScope.selectedCaseIds.length < run.caseScope.totalCases)) && <p className="doc-notice">{!run.finalReady ? '报告和脚本包保留了本轮结果并标注未验证项；请复核证据后再决定是否重跑。' : '本轮只执行了所选回归子集；未选用例不在本次结果范围内。'}</p>}
    {run.coverageSummary && <p className="doc-notice">已识别领域：{run.coverageSummary.projectAreas.map(area => categoryOptions.find(option => option.value === area)?.label ?? area).join('、') || '无'}；本轮覆盖：{run.coverageSummary.selectedAreas.map(area => categoryOptions.find(option => option.value === area)?.label ?? area).join('、') || '无'}；本轮未覆盖：{run.coverageSummary.notCoveredThisRun.map(area => categoryOptions.find(option => option.value === area)?.label ?? area).join('、') || '无'}。这是整理后用例的分类汇总，不代表需求完整性审计。</p>}
    {run.caseScopeKnown === false && <p className="doc-notice">这是旧版运行记录，原始执行范围信息缺失；页面仅按留存的逐用例结果统计，不能据此判断全量覆盖。</p>}
    {run.baselineRunId && <section className="doc-baseline-comparison">
      <div><h3>历史基线对比</h3><p>基线运行：{run.baselineRunId}</p>
        {run.baselineRunSnapshot && <>
          <p>基线版本：{run.baselineRunSnapshot.siteVersionSnapshot ? `${run.baselineRunSnapshot.siteVersionSnapshot.environment} · ${run.baselineRunSnapshot.siteVersionSnapshot.label}` : '未登记网站版本'} · {new Date(run.baselineRunSnapshot.startedAt).toLocaleString()}</p>
          <p>基线目标网址：{run.baselineRunSnapshot.siteVersionSnapshot?.targetUrl ?? '未登记'} · 验证方式：{run.baselineRunSnapshot.runMode === 'regression' ? '常规回归' : run.baselineRunSnapshot.runMode === 'compare' ? 'AI 辅助对照' : '历史运行未记录'}</p>
          <p>基线范围：{run.baselineRunSnapshot.scopePlan ? `直接目标 ${run.baselineRunSnapshot.scopePlan.targetCaseIds.length} 条 · 关联影响 ${run.baselineRunSnapshot.scopePlan.impactCaseIds.length} 条` : `旧记录范围未分类 · 本轮 ${run.baselineRunSnapshot.selectedCaseCount}/${run.baselineRunSnapshot.totalCases} 条`}</p>
          <small>基线用例版本 {run.baselineRunSnapshot.caseVersion?.slice(0, 12) ?? '未记录'} · 资料版本 {run.baselineRunSnapshot.materialVersion?.slice(0, 12) ?? '未记录'} · 测试数据版本 {run.baselineRunSnapshot.testDataVersion?.slice(0, 12) ?? '未记录'}</small>
        </>}
        {run.baselineEnvironmentComparison === 'different' && <p className="doc-notice">当前与基线的环境标识或目标站点来源不同。状态变化不能单独归因于本次迭代。</p>}
        {run.baselineEnvironmentComparison === 'unknown' && <p className="doc-notice">当前或基线运行缺少有效的环境或目标站点来源记录，无法确认两者一致。</p>}
        {run.baselineRunModeComparison === 'different' && <p className="doc-notice">本次验证方式与基线不同；通道差异可能影响结果变化判断。</p>}
        {run.baselineRunModeComparison === 'unknown' && <p className="doc-notice">本次或基线未记录验证方式，无法确认两轮方法一致。</p>}
        {run.baselineMaterialChanged && <p className="doc-notice">需求/测试资料版本与基线不同。状态变化已列出，请先复核新旧测试依据是否等价。</p>}
        {run.baselineRunSnapshot && (!run.materialVersion || !run.baselineRunSnapshot.materialVersion) && <p className="doc-notice">本轮或基线缺少需求/测试资料版本记录，无法确认资料是否一致。</p>}
        {run.baselineTestDataChanged && <p className="doc-notice">本轮测试数据版本与基线不同，变化结果可能同时受输入数据影响。</p>}
        {run.baselineRunSnapshot && (!run.testDataVersion || !run.baselineRunSnapshot.testDataVersion) && <p className="doc-notice">本轮或基线缺少测试数据版本记录，无法确认测试数据是否一致。</p>}
      </div>
      {baselineGroups.length ? <div className="doc-baseline-groups">{baselineGroups.map(group => <section className={`doc-baseline-group baseline-group-${group.group}`} key={group.group}><h4>{group.label} · {group.items.length}</h4><div className="doc-baseline-list">{group.items.map(item => <article key={item.caseId} className={`baseline-${item.disposition}`}><strong>{baselineDispositionLabels[item.disposition]} · {item.title} ({item.caseId})</strong><span>基线：{baselineStatusLabels[item.baselineStatus ?? ''] ?? '无结果'} → 本次：{baselineStatusLabels[item.currentStatus ?? ''] ?? '无结果'}</span><small>范围：基线 {baselineCaseScopeLabel(item.caseId)} → 本轮 {currentBaselineCaseScopeLabel(item)}</small>{item.caseChanged && <small>用例步骤或预期已修改；请先复核用例变化，再判断是否为产品回归。</small>}</article>)}</div></section>)}</div> : <p className="doc-notice">本次运行未形成可比较的逐用例结果。</p>}
    </section>}
    <div className={`doc-lanes ${run.runMode === 'regression' ? 'single' : ''}`}><Lane title="确定性脚本" lane={run.deterministic} scopePlan={run.scopePlan} caseScopeKnown={run.caseScopeKnown}/>{run.runMode !== 'regression' && <Lane title="视觉 Computer Use" lane={run.ai} scopePlan={run.scopePlan} caseScopeKnown={run.caseScopeKnown}/>}</div>
    <div className="doc-comparisons"><h3>{run.runMode === 'regression' ? '逐用例回归结果' : '逐用例结果对照'}</h3>{run.scopePlan ? <>
      <section className="doc-comparison-group target"><h4>直接测试目标 · {run.scopePlan.targetCaseIds.length} 条</h4>{targetComparisons.length ? targetComparisons.map(renderComparison) : <p className="doc-scope-empty">没有留存直接目标的逐用例结果。</p>}</section>
      {run.scopePlan.impactCaseIds.length > 0 && <section className="doc-comparison-group impact"><h4>关联影响检查 · {run.scopePlan.impactCaseIds.length} 条</h4>{impactComparisons.length ? impactComparisons.map(renderComparison) : <p className="doc-scope-empty">没有留存关联影响用例的逐用例结果。</p>}</section>}
      {(run.scopePlan.prerequisiteCaseIds?.length ?? 0) > 0 && <section className="doc-comparison-group prerequisite"><h4>自动补入前置 · {run.scopePlan.prerequisiteCaseIds!.length} 条</h4>{prerequisiteComparisons.length ? prerequisiteComparisons.map(renderComparison) : <p className="doc-scope-empty">没有留存前置用例的逐用例结果。</p>}</section>}
      {excludedCaseIds.length > 0 && <section className="doc-comparison-group unverified"><h4>本轮未验证 · {excludedCaseIds.length} 条</h4><p>这些用例没有在本轮执行；当前结果不能说明它们未受影响。</p><ul>{excludedCaseLabels.slice(0, 20).map(item => <li key={item.id}>{item.title} · {item.id}</li>)}</ul>{excludedCaseLabels.length > 20 && <small>另有 {excludedCaseLabels.length - 20} 条未验证用例。</small>}</section>}
    </> : run.comparisons.map(renderComparison)}</div>
    {run.stepLogs?.length ? <details className="doc-run-step-logs"><summary>确定性步骤日志与检查点 · {run.stepLogs.length} 条</summary><ol>{run.stepLogs.map((item, index) => <li key={`${item.caseId}-${item.stepIndex}-${item.phase}-${index}`}><strong>{item.caseId} · 步骤 {item.stepIndex + 1} · {item.action} · {item.phase === 'before' ? '动作前' : item.phase === 'passed' ? '完成' : '失败'}</strong><small>{new Date(item.at).toLocaleString()}</small></li>)}</ol>{run.stepCheckpoint && <p>最后检查点：{run.stepCheckpoint.caseId} · 下次步骤 {run.stepCheckpoint.nextStepIndex + 1} · {run.stepCheckpoint.phase === 'failed' ? `失败后需人工检查：${run.stepCheckpoint.reason ?? '动作是否发生尚未确认。'}` : '动作已确认完成，可用于核对恢复边界。'}</p>}</details> : null}
    {run.analysis && <div className="doc-analysis"><h3>{run.runMode === 'regression' ? '运行说明' : 'Agent 对差异的分析建议'}</h3><p>{run.analysis}</p>{run.runMode !== 'regression' && !run.finalReady && <small>分析只给出复核建议，不会未经审核修改用例或自动把失败改成通过。修订并重新审核后，可在上方再次运行。</small>}</div>}
  </section>;
}
