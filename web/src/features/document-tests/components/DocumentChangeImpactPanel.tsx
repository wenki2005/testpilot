import type { Dispatch, SetStateAction } from 'react';
import type { ImpactAnalysis, Project, SiteVersion } from '../types';
type PanelProps = {
    project: Project;
    busy: boolean;
    version: {
        selected?: SiteVersion;
        setSelectedId(id: string): void;
        label: string;
        setLabel(value: string): void;
        environment: string;
        setEnvironment(value: string): void;
        targetUrl: string;
        setTargetUrl(value: string): void;
        changeNotes: string;
        setChangeNotes(value: string): void;
    };
    impact: {
        selected?: ImpactAnalysis;
        selectedCaseIds: string[];
        setSelectedCaseIds: Dispatch<SetStateAction<string[]>>;
        reviewNotes: string;
        setReviewNotes(value: string): void;
    };
    actions: {
        registerSiteVersion(): void;
        analyzeIterationImpact(): void;
        createIterationCaseDraft(): void;
        reviewIterationImpact(decision: 'accept' | 'reject'): void;
        addAcceptedImpactToRun(): void;
    };
    onSelectVersion(version: SiteVersion | undefined): void;
};
export function DocumentChangeImpactPanel({ project, busy, version, impact, actions, onSelectVersion }: PanelProps) {
    const analysis = impact.selected;
    const selectedIds = impact.selectedCaseIds;
    const setSelectedIds = impact.setSelectedCaseIds;
    return <>
    <section className="doc-site-version-card" id="doc-version">
      <div className="doc-section-head"><div><h2>网站版本与迭代</h2><p>每轮测试固定使用一个版本和环境。</p></div><span className={'table-status ' + (version.selected ? 'status-passed' : 'status-running')}>{version.selected ? version.selected.environment + ' · ' + version.selected.label : '尚未登记版本'}</span></div>
      {(project.siteVersions?.length ?? 0) > 0
            ? <>
          <label>测试版本<select aria-label="本轮测试的网站版本" value={version.selected?.id ?? ''} onChange={event => onSelectVersion(project.siteVersions?.find(item => item.id === event.target.value))}>
            {project.siteVersions?.map(item => <option key={item.id} value={item.id}>{item.environment} · {item.label}</option>)}
          </select></label>
          {version.selected && <div className="doc-site-version-meta"><div><strong>本轮目标</strong><span>{version.selected.targetUrl}</span></div><div><strong>迭代说明</strong><span>{version.selected.changeNotes || '未填写'}</span></div><small>登记时间：{new Date(version.selected.createdAt).toLocaleString()}</small></div>}
        </>
            : <p className="doc-notice">当前项目尚无版本记录。登记后，运行将明确绑定网站版本；之前的旧运行仍显示为未登记。</p>}
      <details className="doc-site-version-form"><summary>登记一个网站版本</summary><div className="doc-site-version-fields">
        <label>版本标识<input value={version.label} onChange={event => version.setLabel(event.target.value)} maxLength={80} placeholder="例如 v1.8.2 或 2026.10.21-rc1"/></label>
        <label>测试环境<input value={version.environment} onChange={event => version.setEnvironment(event.target.value)} maxLength={80} placeholder="主环境"/></label>
        <label>部署网址<input value={version.targetUrl} onChange={event => version.setTargetUrl(event.target.value)} maxLength={2000} placeholder="https://test.example.com/"/></label>
        <label className="doc-site-version-notes">本次迭代说明<textarea value={version.changeNotes} onChange={event => version.setChangeNotes(event.target.value)} maxLength={2000} placeholder="说明本次更新内容，供运行历史和回归差异复核"/></label>
        <button className="button-secondary" disabled={busy || !version.label.trim() || !version.environment.trim() || !version.targetUrl.trim()} onClick={actions.registerSiteVersion}>{busy ? '正在登记…' : '保存网站版本'}</button>
      </div></details>
    </section>
    <section className="doc-impact-card" id="doc-impact">
      <div className="doc-section-head"><div><h2>迭代影响建议</h2><p>按变更说明推荐用例，确认后再加入本轮。</p></div>{analysis && <span className={'table-status ' + (analysis.status === 'accepted' ? 'status-passed' : 'status-running')}>{analysis.status === 'pending' ? '待人工审核' : analysis.status === 'accepted' ? '已确认' : '已拒绝'}</span>}</div>
      {!version.selected && <p className="doc-notice">先登记并选择一个网站版本，再分析迭代影响。</p>}
      {version.selected && !version.selected.changeNotes.trim() && <p className="doc-notice">当前版本没有迭代说明。登记新版本时补充变更内容后，才能生成有依据的影响建议。</p>}
      {version.selected && <div className="doc-impact-actions">
        <button className="button-secondary" disabled={busy || !version.selected.changeNotes.trim()} onClick={actions.analyzeIterationImpact}>分析迭代影响</button>
        <button className="text-button" disabled={busy || !version.selected.changeNotes.trim()} onClick={actions.createIterationCaseDraft}>新增待完善用例</button>
        <small>补全步骤和预期后才能运行。</small>
      </div>}
      {analysis && <div className="doc-impact-results">
        <div className="doc-impact-note"><strong>分析依据 · {analysis.siteVersionLabel}</strong><span>{analysis.changeNotesSnapshot}</span><small>确定性关键词匹配 · {new Date(analysis.analyzedAt).toLocaleString()} · 仅为候选建议，不代表语义覆盖或产品缺陷结论。</small></div>
        {analysis.suggestions.length > 0 ? <fieldset className="doc-impact-suggestions" disabled={busy || analysis.status !== 'pending'}>
          <legend>可能受影响的用例（可调整本次确认范围）</legend>
          {analysis.suggestions.map(suggestion => <label className="doc-impact-suggestion" key={suggestion.caseId}>
            <input type="checkbox" checked={selectedIds.includes(suggestion.caseId)} onChange={event => setSelectedIds(ids => event.target.checked ? [...new Set([...ids, suggestion.caseId])] : ids.filter(id => id !== suggestion.caseId))}/>
            <span><strong>{suggestion.title}</strong><small>{suggestion.caseId} · 匹配分 {suggestion.score.toFixed(1)} · 词项：{suggestion.matchedTerms.join('、')}</small><small>依据：{suggestion.evidence.join('；')}</small></span>
          </label>)}
        </fieldset> : <p className="doc-notice">没有找到足够匹配的现有用例。请检查未匹配词项，必要时手工新增草稿。</p>}
        {analysis.status === 'pending' && <details className="doc-impact-manual-picker">
          <summary>手动补充其他用例</summary>
          <div>{project.cases.map(item => <label key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={busy} onChange={event => setSelectedIds(ids => event.target.checked ? [...new Set([...ids, item.id])] : ids.filter(id => id !== item.id))}/><span>{item.title}<small>{item.id}{item.modulePath?.length ? ' · ' + item.modulePath.join(' / ') : ''}</small></span></label>)}</div>
        </details>}
        {analysis.unmatchedTerms.length > 0 && <div className="doc-impact-unmatched"><strong>没有匹配到用例的变更词</strong><span>{analysis.unmatchedTerms.join('、')}</span><small>这些词可能代表新功能或当前用例信息不足，请人工判断是否新增或修改用例。</small></div>}
        {analysis.status === 'pending' && <>
          <label className="doc-impact-review-notes">审核备注（可选）<textarea value={impact.reviewNotes} maxLength={1000} onChange={event => impact.setReviewNotes(event.target.value)} placeholder="记录为什么确认或拒绝这些用例"/></label>
          <div className="doc-buttons"><button className="button-primary" disabled={busy || selectedIds.length === 0} onClick={() => actions.reviewIterationImpact('accept')}>确认所选影响用例</button><button className="button-secondary" disabled={busy} onClick={() => actions.reviewIterationImpact('reject')}>拒绝本次建议</button></div>
        </>}
        {analysis.status === 'accepted' && <div className="doc-impact-confirmed"><strong>已确认 {analysis.selectedCaseIds?.length ?? 0} 条影响用例</strong>{analysis.reviewNotes && <span>审核备注：{analysis.reviewNotes}</span>}<button className="button-secondary" disabled={busy || !(analysis.selectedCaseIds?.length)} onClick={actions.addAcceptedImpactToRun}>将已确认用例加入本轮范围</button><small>只调整本轮选择，不改用例步骤或预期；实际运行仍由你手动启动。</small></div>}
        {analysis.status === 'rejected' && <p className="doc-notice">本次建议已拒绝并留档。需要重新判断时，可重新分析当前版本。</p>}
      </div>}
    </section>
  </>;
}
