import type { Project, RunListItem, TestDataSet } from '../types';
import { runOutcomeLabels, runScopeLabels } from '../presentation';

export function RunConfigurationPanel(props: {
  project: Project;
  busy: boolean;
  addCase(): void;
  configuration: {
    notes: string;
    setNotes(value: string): void;
    runMode: 'regression' | 'compare';
    setRunMode(value: 'regression' | 'compare'): void;
    dataParameterInputs: Array<{ key: string; required: boolean; label: string }>;
    testDataSetId: string;
    parameterValues: Record<string, string>;
    testDataSetName: string;
    selectedTestDataSet: TestDataSet | undefined;
    selectDataSet(id: string): void;
    setParameterValue(key: string, value: string): void;
    setTestDataSetName(value: string): void;
    saveTestDataSet(): void;
    deleteTestDataSet(): void;
    baselineRunId: string;
    setBaselineRunId(id: string): void;
    runHistory: RunListItem[];
    baselineEnvironmentReview: 'same' | 'different' | 'unknown' | undefined;
    baselineRunModeReview: 'same' | 'different' | 'unknown' | undefined;
  };
}) {
  const { project, busy, addCase, configuration } = props;
  const config = configuration;
  return <>
    <div className="doc-section-head"><div><h2>运行回归测试</h2><p>在这里选择单条用例或一组模块，审核后手动启动本轮回归。</p></div></div>
    <button className="button-secondary doc-add-case" onClick={addCase}>＋ 添加测试用例</button>
    <label>测试备注<textarea value={config.notes} onChange={event => config.setNotes(event.target.value)} maxLength={2000} /></label>
    <label>运行方式<select value={config.runMode} onChange={event => config.setRunMode(event.target.value as 'regression' | 'compare')}><option value="regression">常规回归 · 优先复用步骤</option><option value="compare">AI 辅助对照 · 确定性 + 视觉</option></select></label>
    {config.dataParameterInputs.length > 0 && <fieldset className="doc-parameter-panel">
      <legend>本轮测试参数</legend>
      <p>账号使用 Edge 登录态；测试数据请用合成数据。</p>
      <label>复用已保存的数据组<select aria-label="复用已保存的数据组" value={config.testDataSetId} onChange={event => config.selectDataSet(event.target.value)}>
        <option value="">手动填写本轮参数</option>
        {project.testDataSets?.map(item => <option key={item.id} value={item.id}>{item.name} · 更新于 {new Date(item.updatedAt).toLocaleString()}</option>)}
      </select></label>
      <div className="doc-parameter-fields">{config.dataParameterInputs.map(({ key, required, label }) => <label key={key}>{label}<small>{required ? '必需' : '可选，留空不阻断'}</small><input aria-label={'参数 ' + key} value={config.parameterValues[key] ?? config.selectedTestDataSet?.values[key] ?? ''} maxLength={500} onChange={event => config.setParameterValue(key, event.target.value)} /></label>)}</div>
      <div className="doc-parameter-save"><label>{config.selectedTestDataSet ? '数据组名称' : '保存为数据组'}<input aria-label="数据组名称" value={config.testDataSetName} onChange={event => config.setTestDataSetName(event.target.value)} maxLength={80} placeholder="例如：有效申请数据" /></label>
        <button className="button-secondary" disabled={busy || !config.testDataSetName.trim()} onClick={config.saveTestDataSet}>{config.selectedTestDataSet ? '更新当前数据组' : '保存为新数据组'}</button>
        {config.selectedTestDataSet && <button className="text-button" disabled={busy} onClick={config.deleteTestDataSet}>删除当前数据组</button>}
      </div>
    </fieldset>}
    <label>历史回归基线（可选）<select aria-label="历史回归基线" value={config.baselineRunId} onChange={event => config.setBaselineRunId(event.target.value)}>
      <option value="">不与历史运行比较</option>
      {config.runHistory.filter(item => item.baselineEligible).map(item => <option key={item.id} value={item.id}>{item.siteVersionSnapshot ? `${item.siteVersionSnapshot.environment} · ${item.siteVersionSnapshot.label}` : '未登记网站版本'} · {item.runMode === 'regression' ? '常规回归' : item.runMode === 'compare' ? 'AI 对照' : '方式未知'} · {new Date(item.startedAt).toLocaleString()} · {runOutcomeLabels[item.overall] ?? item.overall} · {item.scopePlan ? `${runScopeLabels[item.scopePlan.mode]} ${item.scopePlan.targetCaseIds.length}目标/${item.scopePlan.impactCaseIds.length}影响` : '旧版范围未标注'} · {item.selectedCaseCount}/{item.totalCases} 条</option>)}
    </select><small>{config.runHistory.some(item => item.baselineEligible) ? '修改过的用例会单独标记。' : '完成一轮可判定的运行后可设为基线。'}</small></label>
    {config.baselineEnvironmentReview === 'different' && <p className="doc-notice">当前与基线的环境标识或目标站点来源不同；结果变化不能单独归因于本次迭代。</p>}
    {config.baselineEnvironmentReview === 'unknown' && <p className="doc-notice">当前或基线运行缺少有效的环境或目标站点来源记录，无法确认两者一致；结果中会保留此限制。</p>}
    {config.baselineRunModeReview === 'different' && <p className="doc-notice">当前验证方式与基线不同；请确认脚本回归和 AI 辅助对照之间的差异不会解释本轮状态变化。</p>}
    {config.baselineRunModeReview === 'unknown' && <p className="doc-notice">基线未记录验证方式，无法确认两轮使用相同的验证方法。</p>}
  </>;
}
