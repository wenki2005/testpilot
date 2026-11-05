import React from 'react';
void React; // Retain the binding for the repository's classic JSX test transform.
import type { Check, Project, RunScopePlan, StepProbeResult } from '../types';
import { StepProbeNotice } from './StepProbeNotice';
import { CaseCodeViewer } from './CaseCodeViewer';
import { canSelectCaseForRun } from '../case-selection';
import { categoryOptions, createEditableStep, editableStepActions, stepFieldSpecs } from '../presentation';
import { documentProjectRevisionDigest } from '../../../../../src/domain/documents/projects/project-revision-digest.js';
export function DocumentCaseEditorList(props: {
    project: Project;
    scope: RunScopePlan;
    busy: boolean;
    editorNotice?: string;
    onRunCase(caseId: string): void;
    stepDrafts: Record<string, string>;
    probeBusyKey: string;
    probeResults: Record<string, StepProbeResult>;
    cases: {
        insert?(anchorId: string, position: 'before' | 'after'): void;
        move?(caseId: string, delta: -1 | 1): void;
        toggleSelection(index: number, checked: boolean): void;
        selectOnly(caseId: string): void;
        remove(caseId: string): void;
        edit(index: number, key: keyof Check, value: string): void;
        editList(index: number, key: 'requirementRefs' | 'preconditions' | 'testData' | 'coverageAreas' | 'modulePath' | 'tags' | 'dependsOnCaseIds', value: string): void;
        setTestDataRequirements(index: number, requirements: NonNullable<Check['testDataRequirements']>): void;
        setLifecycle(index: number, value: NonNullable<Check['lifecycleStatus']>): void;
        confirmPreconditions(index: number, checked: boolean): void;
        editSteps(item: Check, value: string): void;
    };
    steps: {
        update(index: number, value: Check['steps']): void;
        change(caseIndex: number, stepIndex: number, key: string, value: string): void;
        add(caseIndex: number, action: string): void;
        remove(caseIndex: number, stepIndex: number): void;
        move(caseIndex: number, stepIndex: number, delta: number): void;
        probe(caseId: string, stepIndex: number): Promise<void>;
    };
}) {
    const { project, scope, busy, onRunCase, stepDrafts, probeBusyKey, probeResults, cases, steps } = props;
    return <div className="doc-case-list">{props.editorNotice && <p role="status">{props.editorNotice}</p>}{project.cases.map((item, index) => <article className={`doc-case ${!canSelectCaseForRun(item) || item.selectedForRegression === false ? 'case-excluded' : ''}`} key={item.id}>
    <header><label className="doc-case-select"><input type="checkbox" checked={canSelectCaseForRun(item) && item.selectedForRegression !== false} disabled={!canSelectCaseForRun(item)} onChange={event => cases.toggleSelection(index, event.target.checked)}/><span>本轮执行</span></label><span>用例 {String(index + 1).padStart(2, '0')}</span><input aria-label="用例标题" value={item.title} onChange={event => cases.edit(index, 'title', event.target.value)}/>{canSelectCaseForRun(item) && <><button className="text-button" onClick={() => cases.selectOnly(item.id)}>选择单项</button><button className="text-button" disabled={busy} onClick={() => onRunCase(item.id)}>运行此用例</button></>}<button className="text-button" onClick={() => cases.remove(item.id)}>移除</button></header>
    <CaseCodeViewer key={`${project.id}:${item.id}`} projectId={project.id} caseId={item.id} title={item.title}/>
    <div className="doc-case-order-actions" role="group" aria-label={`${item.title}的用例顺序`}>
      <button type="button" className="text-button" disabled={busy || !cases.insert || project.cases.length >= 200} onClick={() => cases.insert?.(item.id, 'before')}>在前新增</button>
      <button type="button" className="text-button" disabled={busy || !cases.insert || project.cases.length >= 200} onClick={() => cases.insert?.(item.id, 'after')}>在后新增</button>
      <button type="button" className="text-button" disabled={busy || !cases.move || index === 0} onClick={() => cases.move?.(item.id, -1)}>用例上移</button>
      <button type="button" className="text-button" disabled={busy || !cases.move || index === project.cases.length - 1} onClick={() => cases.move?.(item.id, 1)}>用例下移</button>
    </div>
    <details className="doc-case-detail"><summary>详情 · {item.preconditions?.length ?? 0} 条前置 · {item.steps.length} 步 · 预期、数据与历史证据</summary>
    {scope.targetCaseIds.includes(item.id) && <span className="doc-case-scope-badge target">直接目标</span>}{scope.impactCaseIds.includes(item.id) && <span className="doc-case-scope-badge impact">关联影响</span>}
    <p className="doc-source">需求依据：{item.source}</p>
    {item.caseOrigin === 'iteration-impact-draft' && <p className="doc-notice"><strong>迭代待完善草稿</strong> · 默认不纳入本轮；请补充模块、可判定的预期、步骤、前置条件和测试数据后再考虑启用。</p>}
    {item.executionRoute && <p className="doc-notice"><strong>执行路径：{{ 'browser-ui': '网页 UI', 'api-contract': 'API / 后端契约', 'fixture-or-role': '测试数据 / 身份夹具', 'source-review': '源码 / 安全审查', clarification: '待澄清', 'out-of-scope': '范围外', 'manual-analysis': '人工补充需求' }[item.executionRoute] ?? item.executionRoute}</strong> · {item.executionReason ?? '待分析'}<br />下一步：{item.nextAction ?? '补充执行依据后重新生成'}</p>}
    <div className="doc-case-fields"><label>附加断言<select value={item.kind} onChange={event => cases.edit(index, 'kind', event.target.value)}><option value="text">页面含有文本</option><option value="visible">文本可见</option><option value="field">标签字段可见</option></select></label><label>预期文本 / 字段标签<input value={item.expected} onChange={event => cases.edit(index, 'expected', event.target.value)}/></label></div>
    <div className="doc-case-metadata">
      <label>用例状态<select aria-label={`用例状态 ${item.id}`} value={item.lifecycleStatus ?? 'runnable'} onChange={event => cases.setLifecycle(index, event.target.value as NonNullable<Check['lifecycleStatus']>)}><option value="draft">草稿 · 尚未纳入运行</option><option value="runnable">可运行 · 可加入本轮</option><option value="disabled">停用 · 暂不执行</option></select><small>修改用例内容后会退回草稿；标记为可运行后仍需单独勾选本轮范围。</small></label>
      <label>优先级<select value={item.priority ?? 'P2'} onChange={event => cases.edit(index, 'priority', event.target.value)}><option value="P0">P0 · 阻断级</option><option value="P1">P1 · 高</option><option value="P2">P2 · 普通</option><option value="P3">P3 · 低</option></select></label>
      <label>主要分类<select value={item.category ?? 'functional'} onChange={event => cases.edit(index, 'category', event.target.value)}>{categoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>预期置信度<select value={item.confidence ?? 'medium'} onChange={event => cases.edit(index, 'confidence', event.target.value)}><option value="high">高 · 需求明确且可直接验证</option><option value="medium">中 · 需要按上下文解释</option><option value="low">低 · 需求含糊或预期待补充</option></select></label>
      <label>副作用风险<select value={item.sideEffectRisk ?? 'unknown'} onChange={event => cases.edit(index, 'sideEffectRisk', event.target.value)}><option value="none">无外部副作用（只读）</option><option value="reversible">可逆副作用</option><option value="irreversible">不可逆副作用</option><option value="unknown">未知，需先评估</option></select></label>
      <label>业务模块路径（每行一层）<textarea value={(item.modulePath ?? []).join('\n')} onChange={event => cases.editList(index, 'modulePath', event.target.value)} placeholder="例如：申请流程\n权限控制"/><small>可从 XMind 主题路径导入；允许在此调整层级。模块路径用于整组选例和单模块运行。</small></label>
      <label>显式前置用例 ID（每行一条）<textarea value={(item.dependsOnCaseIds ?? []).join('\n')} onChange={event => cases.editList(index, 'dependsOnCaseIds', event.target.value)} placeholder="例如：case-setup-01"/><small>只填写当前项目内的稳定用例 ID。启动时会检查依赖并按顺序自动补入；不会从标题或前置说明推断。</small></label>
      <label>页面入口路径（可选）<input value={item.entryPath ?? ''} onChange={event => cases.edit(index, 'entryPath', event.target.value)} placeholder="例如：/apply/orders"/><small>可直接从本轮网站版本打开同源页面；留空时从版本首页开始。不要填写外站地址或凭证参数。</small></label>
      <label>标签（每行一项）<textarea value={(item.tags ?? []).join('\n')} onChange={event => cases.editList(index, 'tags', event.target.value)} placeholder="例如：冒烟、核心链路、迭代回归"/><small>每条用例最多 20 个标签；会进入用例版本与运行快照。</small></label>
      <label>覆盖领域（每行一项）<textarea value={(item.coverageAreas ?? [item.category ?? 'functional']).join('\n')} onChange={event => cases.editList(index, 'coverageAreas', event.target.value)} placeholder="例如：authorization、boundary；主要分类会自动纳入"/></label>
      <label>需求追溯（每行一条）<textarea value={(item.requirementRefs ?? [item.source]).join('\n')} onChange={event => cases.editList(index, 'requirementRefs', event.target.value)} placeholder="需求章节 / XMind 路径 / 用例 ID"/></label>
      <label>前置条件（每行一条）<textarea value={(item.preconditions ?? []).join('\n')} onChange={event => cases.editList(index, 'preconditions', event.target.value)} placeholder="例如：使用已准备的测试账号，且申请表为空"/>{(item.preconditions ?? []).length > 0 && <span className="case-precondition-confirm"><input type="checkbox" checked={item.preconditionsConfirmed === true} onChange={event => cases.confirmPreconditions(index, event.target.checked)}/>我确认本次测试环境已满足以上条件</span>}</label>
      <label>测试数据 / fixture 引用（每行一条）<textarea value={(item.testData ?? []).join('\n')} onChange={event => cases.editList(index, 'testData', event.target.value)} placeholder="写合成数据说明或 fixture 名称；不要填写真实密码或个人资料"/></label>
      <div className="doc-fixture-requirements" aria-label={`结构化测试数据要求 ${item.id}`}>
        <div className="doc-step-editor-head"><strong>结构化测试数据要求</strong><button type="button" className="text-button" onClick={() => cases.setTestDataRequirements(index, [...(item.testDataRequirements ?? []), { key: '', description: '', required: true }])}>新增字段要求</button></div>
        {(item.testDataRequirements ?? []).map((requirement, requirementIndex) => <div className="doc-fixture-requirement" key={requirementIndex}>
          <label>字段 key<input aria-label={`测试数据字段 ${requirementIndex + 1} key`} value={requirement.key} onChange={event => { const next = [...(item.testDataRequirements ?? [])]; next[requirementIndex] = { ...requirement, key: event.target.value }; cases.setTestDataRequirements(index, next); }}/></label>
          <label>字段说明<input aria-label={`测试数据字段 ${requirementIndex + 1} 说明`} value={requirement.description} onChange={event => { const next = [...(item.testDataRequirements ?? [])]; next[requirementIndex] = { ...requirement, description: event.target.value }; cases.setTestDataRequirements(index, next); }}/></label>
          <label>来源引用（可空）<input aria-label={`测试数据字段 ${requirementIndex + 1} 来源`} value={requirement.source ?? ''} onChange={event => { const next = [...(item.testDataRequirements ?? [])]; next[requirementIndex] = { ...requirement, source: event.target.value || undefined }; cases.setTestDataRequirements(index, next); }}/></label>
          <label><input type="checkbox" aria-label={`测试数据字段 ${requirementIndex + 1} 必需`} checked={requirement.required} onChange={event => { const next = [...(item.testDataRequirements ?? [])]; next[requirementIndex] = { ...requirement, required: event.target.checked }; cases.setTestDataRequirements(index, next); }}/>必需</label>
          <button type="button" className="text-button" onClick={() => cases.setTestDataRequirements(index, (item.testDataRequirements ?? []).filter((_entry, i) => i !== requirementIndex))}>删除字段</button>
        </div>)}
        <small>此处登记字段要求，不填写业务数据值。修改后用例会退回草稿并取消本轮选择；保存时由服务端校验。</small>
      </div>
      <label>清理步骤<textarea value={item.cleanup ?? ''} onChange={event => cases.edit(index, 'cleanup', event.target.value)} placeholder="可逆副作用如何恢复；无副作用可留空"/></label>
    </div>
    <section className="doc-step-editor" aria-label={item.title + ' 的可视化步骤编辑器'}>
      <div className="doc-step-editor-head"><strong>操作与检查步骤</strong><span>{item.steps.length} 步 · 可拖动顺序按钮调整</span></div>
      {item.steps.map((step, stepIndex) => <article className="doc-step-row" key={stepIndex}>
        <header><span>第 {stepIndex + 1} 步</span><select aria-label={'步骤 ' + (stepIndex + 1) + ' 动作'} value={step.action} onChange={event => { const next = [...item.steps]; next[stepIndex] = createEditableStep(event.target.value); steps.update(index, next); }}>
          {!editableStepActions.some(option => option.value === step.action) && <option value={step.action}>高级动作 · {step.action}</option>}
          {editableStepActions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select><button className="text-button" disabled={stepIndex === 0} onClick={() => steps.move(index, stepIndex, -1)}>上移</button><button className="text-button" disabled={stepIndex === item.steps.length - 1} onClick={() => steps.move(index, stepIndex, 1)}>下移</button><button className="text-button" disabled={busy || !!probeBusyKey || project.reviewStatus !== 'approved'} title={project.reviewStatus !== 'approved' ? '请先保存并审核步骤，才能试定位已保存版本' : undefined} onClick={() => void steps.probe(item.id, stepIndex)}>{probeBusyKey === `${item.id}:${stepIndex}` ? '定位中…' : '试定位'}</button><button className="text-button" onClick={() => steps.remove(index, stepIndex)}>删除步骤</button></header>
        {probeResults[`${item.id}:${stepIndex}`] && project.reviewStatus === 'approved' && <StepProbeNotice result={probeResults[`${item.id}:${stepIndex}`]!}/>}
        {stepFieldSpecs[step.action]?.length ? <div className="doc-step-fields">{stepFieldSpecs[step.action]!.map(field => <label key={field.key}>{field.label}{field.kind === 'role'
                            ? <select aria-label={'步骤 ' + (stepIndex + 1) + ' ' + field.label} value={step[field.key] ?? 'button'} onChange={event => steps.change(index, stepIndex, field.key, event.target.value)}><option value="button">按钮</option><option value="link">链接</option><option value="radio">单选框</option><option value="checkbox">复选框</option><option value="tab">标签页</option></select>
                            : <input aria-label={'步骤 ' + (stepIndex + 1) + ' ' + field.label} value={step[field.key] ?? ''} onChange={event => steps.change(index, stepIndex, field.key, event.target.value)}/>}</label>)}</div>
                    : <small className="doc-step-advanced-hint">该动作的详细参数可在下方高级 JSON 中编辑。</small>}
      </article>)}
      <label className="doc-step-add">添加步骤或断言<select aria-label={'添加步骤 ' + item.id} value="" onChange={event => steps.add(index, event.target.value)}><option value="">选择动作类型…</option>{editableStepActions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    </section>
    {project.stepAuthoring?.results.filter(result => result.caseId === item.id).map(result => <div key={`${result.caseId}-${project.stepAuthoring?.generatedAt}`} className={`doc-notice ${result.status === 'blocked' ? 'error' : ''}`}><strong>步骤状态：{result.status === 'generated' ? '已生成' : result.status === 'partial' ? '部分生成' : '阻塞'} · {result.stepCount} 步</strong><br />{result.detail}{result.pageEvidence && <div><small>生成时页面依据：{result.pageEvidence.route || '路径未记录'} · 页面快照摘要 {result.pageEvidence.sha256.slice(0, 12)}… · {result.pageEvidence.caseRevisionDigest ? <>用例版本 {result.pageEvidence.caseRevisionDigest.slice(0, 12)}… · {result.pageEvidence.caseRevisionDigest === documentProjectRevisionDigest('case', item.id, item) ? '与当前用例一致' : '与当前用例不一致'}</> : '旧版记录未关联用例版本'} · {result.pageEvidence.stepRevisionDigest ? <>步骤版本 {result.pageEvidence.stepRevisionDigest.slice(0, 12)}… · {result.pageEvidence.stepRevisionDigest === documentProjectRevisionDigest('steps', item.id, item.steps ?? []) ? '与当前步骤一致' : '与当前步骤不一致'}</> : '旧版记录未关联步骤版本'} · {result.pageEvidence.matchedLocators.length} 个定位器与页面匹配。</small>{result.pageEvidence.matchedLocators.length > 0 && <details><summary>查看定位依据摘要</summary><ul>{result.pageEvidence.matchedLocators.map(match => <li key={`${match.stepIndex}-${match.kind}`}>第 {match.stepIndex + 1} 步：{match.kind} · 定位值摘要 {match.valueSha256.slice(0, 12)}…</li>)}</ul></details>}</div>}</div>)}
    {project.stepAuthoring?.results.filter(result => result.caseId === item.id && (result.pageEvidence?.pages?.length ?? 0) > 1).map(result => <details className="doc-step-page-evidence" key={'pages-' + result.caseId + '-' + project.stepAuthoring?.generatedAt}><summary>查看 {result.pageEvidence!.pages!.length} 个页面的证据摘要</summary><ol>{result.pageEvidence!.pages!.map((page, pageIndex) => <li key={pageIndex + '-' + (page.evidenceId ?? page.route)}>第 {pageIndex + 1} 页：{page.route || '路径未记录'} · 页面摘要 {page.sha256.slice(0, 12)}… · {page.matchedLocators.length} 个步骤定位依据{page.evidenceId ? ' · evidenceId ' + page.evidenceId.slice(0, 8) + '…' : ''}</li>)}</ol></details>)}
    {project.stepAuthoring?.results.filter(result => result.caseId === item.id && result.pageEvidence).map(result => <details className="doc-step-page-evidence" key={'exploration-' + result.caseId + '-' + project.stepAuthoring?.generatedAt}><summary>AI 页面探索决策复核{result.pageEvidence!.explorationStatus === 'incomplete' ? ' · 未完成' : result.pageEvidence!.explorationStatus === 'stopped' ? ' · 已停止（不代表穷尽）' : ' · 旧版/状态未知'}</summary>{!result.pageEvidence!.explorationStatus || !result.pageEvidence!.decisionTrace ? <p role="note">旧版证据未保存 AI 决策轨迹，探索完整性未知；请人工复核需求和页面覆盖。</p> : <><p>探索状态：{result.pageEvidence!.explorationStatus === 'stopped' ? 'AI 已停止，页面覆盖不保证穷尽' : result.pageEvidence!.explorationStatus === 'incomplete' ? '探索未完成，候选需人工复核' : '旧版单页采集，不含跨页决策'}</p><ol>{result.pageEvidence!.decisionTrace.map(entry => <li key={entry.sequence}>决策 {entry.sequence}：{entry.decision === 'follow-link' ? `跟随第 ${Number(entry.linkIndex) + 1} 个可见链接「${entry.selectedLabel ?? '未记录名称'}」${entry.selectedPath ? `（${entry.selectedPath}）` : ''}` : entry.decision === 'stop' ? 'AI 停止继续访问' : '未完成'} · 状态 {entry.status}{entry.latestEvidenceId ? ` · 当前证据 ${entry.latestEvidenceId}` : ''}{entry.resultingEvidenceId ? ` · 到达证据 ${entry.resultingEvidenceId}` : ''}{entry.reason ? ` · ${entry.reason}` : ''}{entry.inputEvidenceIds.length ? <small> · 输入证据：{entry.inputEvidenceIds.join(', ')}</small> : null}</li>)}</ol></>}</details>)}
    <details className="doc-steps-json"><summary>高级 JSON 步骤（可选）</summary><label className="doc-steps-label">浏览器步骤<textarea spellCheck={false} value={stepDrafts[item.id] ?? JSON.stringify(item.steps ?? [], null, 2)} onChange={event => cases.editSteps(item, event.target.value)}/><small>普通操作建议使用上方可视化编辑器；更复杂动作可在此编辑 JSON。文本输入和预期检查可引用 {'{{param:名称}}'}，运行前填写参数或选择测试数据组。提交、保存、删除、支付、确认等动作会被拦截。</small></label></details>
    </details>
  </article>)}</div>;
}
