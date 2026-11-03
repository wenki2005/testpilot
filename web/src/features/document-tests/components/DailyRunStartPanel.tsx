import React, { useEffect, useMemo, useState } from 'react';
import { WebsiteDiscoveryPanel } from './WebsiteDiscoveryPanel';
import { request } from '../api/client';
import type { Project, TestDataSet } from '../types';
import { parameterLabel, parameterNames, parameterDescriptions } from '../presentation';
import { allDailyCasesKey, dailyModuleOptions, dailyModuleCaseIds, previewDailyDependencies, dailyModuleSummary, dailyExecutionIssues, suggestedDailyModule } from '../daily-run-selection';

type Profile = { id: string; name: string; role: string };
type ProfilesResponse = { profiles: Profile[]; activeProfileId: string | null; message: string };

export function handoffModelBlocker(enabled: boolean, modelAvailable: boolean): string {
  return enabled && !modelAvailable ? '前置 AI 观察需要先在模型设置中配置并启用 AI 模型；未配置时不会启动用例。' : '';
}

export function DailyRunStartPanel(props: {
  project: Project;
  modules: Array<[string, string[]]>;
  busy: boolean;
  modelAvailable: boolean;
  activeSiteVersionId?: string;
  testDataSetId: string;
  parameterValues: Record<string, string>;
  selectedTestDataSet?: TestDataSet;
  onSelectDataSet(id: string): void;
  onProfileChanged(): Promise<void>;
  onStart(targetCaseIds: string[], moduleLabel: string, handoffAfterPrerequisites: boolean): void;
}) {
  const { project } = props;
  const modules = useMemo(() => dailyModuleOptions(project.cases), [project.cases]);
  const [moduleKey, setModuleKey] = useState(() => suggestedDailyModule(project.cases, dailyModuleOptions(project.cases)));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(project.activeSessionProfileId ?? null);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [handoffAfterPrerequisites, setHandoffAfterPrerequisites] = useState(false);

  useEffect(() => {
    let current = true;
    setModuleKey(suggestedDailyModule(project.cases, dailyModuleOptions(project.cases)));
    setHandoffAfterPrerequisites(false);
    setProfilesLoading(true);
    setProfileError('');
    void request<ProfilesResponse>(`/api/document-projects/${encodeURIComponent(project.id)}/session-profiles`)
      .then(result => {
        if (!current) return;
        setProfiles(result.profiles ?? []);
        setActiveProfileId(result.activeProfileId ?? null);
      })
      .catch(error => { if (current) setProfileError((error as Error).message); })
      .finally(() => { if (current) setProfilesLoading(false); });
    return () => { current = false; };
  }, [project.id]);

  const selectedModule = modules.find(([key]) => key === moduleKey);
  const optionLabel = (key: string, path: string[]) => {
    const summary = dailyModuleSummary(project.cases, key);
    return `${path.join(' / ')} · ${summary.total} 条，已准备 ${summary.runnable} 条`;
  };
  const moduleSummary = dailyModuleSummary(project.cases,moduleKey);
  const targetCaseIds = useMemo(() => dailyModuleCaseIds(project.cases, moduleKey), [project.cases, moduleKey]);
  const dependencyPreview = useMemo(() => previewDailyDependencies(project.cases, targetCaseIds), [project.cases, targetCaseIds]);
  const executionCases = useMemo(() => {
    const ids = new Set(dependencyPreview.ordered);
    return project.cases.filter(item => ids.has(item.id));
  }, [project.cases, dependencyPreview.ordered.join('\u0000')]);
  const requiredParameters = parameterNames(executionCases);
  const descriptionsByParameter = parameterDescriptions(executionCases);
  const resolvedValues = { ...(props.selectedTestDataSet?.values ?? {}), ...props.parameterValues };
  const missingParameters = requiredParameters.filter(name => !resolvedValues[name]?.trim());
  const selectedVersion = project.siteVersions?.find(item => item.id === props.activeSiteVersionId)
    ?? project.siteVersions?.find(item => item.id === project.activeSiteVersionId)
    ?? project.siteVersions?.at(-1);

  const selectProfile = async (profileId: string) => {
    const nextProfileId = profileId || null;
    setProfileBusy(true);
    setProfileError('');
    try {
      await request<{ activeProfileId: string | null }>(`/api/document-projects/${encodeURIComponent(project.id)}/session-profile`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: nextProfileId }),
      });
      setActiveProfileId(nextProfileId);
      await props.onProfileChanged();
    } catch (error) { setProfileError((error as Error).message); }
    finally { setProfileBusy(false); }
  };

  const blockers = [
    project.platform?.type === 'unknown' || project.platform?.status !== 'confirmed' ? '项目端类型未确认；先确认 PC 网页、移动网页或企微工作台。' : '',
    project.reviewStatus !== 'approved' ? '项目尚未通过用例审核；先核对并审核用例。' : '',
    targetCaseIds.some(id => project.cases.find(item => item.id === id)?.selectedForRegression === false) ? '该模块含有未纳入已审核回归范围的用例；先核对选择范围并重新审核。' : '',
    !moduleKey ? '请选择要运行的模块。' : '',
    moduleKey && targetCaseIds.length === 0 ? `此模块有 ${moduleSummary.total} 条用例，当前尚无已准备的用例；需先补全步骤和具体前置条件。` : '',
    dependencyPreview.error,
    ...dailyExecutionIssues(executionCases),
    handoffModelBlocker(handoffAfterPrerequisites, props.modelAvailable),
    missingParameters.length ? `缺少已保存的必要测试数据：${missingParameters.map(key => parameterLabel(key, descriptionsByParameter)).join('、')}。先选择或完善数据组。` : '',
    profileError ? '账号档案读取或切换失败；请刷新项目后重试。' : '',
  ].filter(Boolean);
  const accountLabel = activeProfileId
    ? profiles.find(profile => profile.id === activeProfileId)?.name ?? '已保存账号档案'
    : '默认账号会话';
  const platformLabel = project.platform?.type === 'pc-web' ? 'PC 网页'
    : project.platform?.type === 'mobile-web' ? '移动网页'
      : project.platform?.type === 'wecom-workbench' ? '企微工作台' : '待确认';

  return <React.Fragment><section className="daily-start" id="doc-daily-start" aria-label="日常回归启动">
    <div className="daily-start-heading"><div><h2>开始测试</h2><p>选择要检查的模块，点击开始即可。</p></div><span className={!blockers.length && !profilesLoading ? 'daily-ready' : 'daily-muted'}>{profilesLoading ? '正在检查准备情况…' : !blockers.length ? '可以开始' : '需要完成准备'}</span></div>
    <div className="daily-launch"><label>测试模块<select aria-label="日常运行模块" value={moduleKey} disabled={props.busy} onChange={event => { setModuleKey(event.target.value); setHandoffAfterPrerequisites(false); }}>
      <option value="">选择全部或一个模块</option><option value={allDailyCasesKey}>{optionLabel(allDailyCasesKey, ['全部用例'])}</option>
      <optgroup label="业务模块">{modules.filter(([key, path]) => key !== allDailyCasesKey && key !== '__unassigned__' && path[0] !== '补充检查').map(([key, path], index) => <option key={key} value={key}>{`模块 ${String(index + 1).padStart(2, '0')} · ${optionLabel(key, path)}`}</option>)}</optgroup>
      {modules.some(([, path]) => path[0] === '补充检查') && <optgroup label="补充检查">{modules.filter(([, path]) => path[0] === '补充检查').map(([key, path]) => <option key={key} value={key}>{optionLabel(key, path.length === 1 ? ['全部补充检查'] : path.slice(1))}</option>)}</optgroup>}
      {modules.filter(([key]) => key === '__unassigned__').map(([key, path]) => <option key={key} value={key}>{optionLabel(key, path)}</option>)}
    </select></label><button type="button" className="button-primary" disabled={props.busy || profileBusy || profilesLoading || blockers.length > 0} onClick={() => props.onStart(targetCaseIds, selectedModule?.[1].join(' / ') ?? '', handoffAfterPrerequisites)}>{props.busy ? '测试进行中…' : '开始测试'}</button></div>
    {selectedModule && <p className="daily-scope" role="status">范围共 <strong>{moduleSummary.total} 条</strong>，本次运行 <strong>{dependencyPreview.ordered.length} 条</strong>{dependencyPreview.prerequisites.length > 0 ? `（含自动前置 ${dependencyPreview.prerequisites.length} 条）` : ''}。{moduleSummary.excluded.length > 0 ? `另有 ${moduleSummary.excluded.length} 条草稿或停用用例不执行。` : ''}{moduleSummary.partial > 0 ? `其中 ${moduleSummary.partial} 条为局部检查，不能代表完整业务通过。` : ''}未运行用例不计为通过。</p>}
    <p className="daily-environment">{platformLabel} · {accountLabel} · {selectedVersion?.environment ?? '项目环境'}<a href="#doc-run-info">查看运行信息</a></p>
    {blockers.length > 0 && <div className="daily-blockers" role="status"><strong>开始前请处理</strong><ul>{blockers.map(item => <li key={item}>{item === '请选择要运行的模块。' ? '请选择上方的测试模块。' : item}</li>)}</ul>{project.reviewStatus !== 'approved' && <a href="#doc-cases">打开用例管理并审核</a>}{missingParameters.length > 0 && <a href="#doc-run-info">选择测试数据</a>}{profileError && <button className="text-button" onClick={() => window.location.reload()}>重新读取项目</button>}</div>}
    <details className="daily-run-info" id="doc-run-info"><summary>运行信息与账号设置</summary>
      <p>入口：{selectedVersion?.targetUrl ?? project.targetUrl}</p><p>版本：{selectedVersion?.label ?? '未登记网站版本'}</p>
      <label>账号<select aria-label="日常运行账号档案" value={activeProfileId ?? ''} disabled={props.busy || profileBusy || profilesLoading} onChange={event => void selectProfile(event.target.value)}><option value="">默认账号会话</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.role}</option>)}</select></label>
      <small>{project.sessionIdentityNote ? `身份备注：${project.sessionIdentityNote}（角色未由系统验证）` : '账号档案为人工备注，登录由使用者在测试浏览器完成。'}</small>
      {requiredParameters.length > 0 && <label>测试数据<select aria-label="日常运行测试数据组" value={props.testDataSetId} disabled={props.busy} onChange={event => props.onSelectDataSet(event.target.value)}><option value="">选择已保存数据组</option>{project.testDataSets?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{props.selectedTestDataSet ? `复用数据组“${props.selectedTestDataSet.name}”` : '选择已有数据组；没有合适数据时到管理与设置中补充。'}</small></label>}
      {selectedModule && dependencyPreview.prerequisites.length > 0 && <label className="daily-handoff"><input type="checkbox" checked={handoffAfterPrerequisites} disabled={props.busy || !!dependencyPreview.error} onChange={event => setHandoffAfterPrerequisites(event.target.checked)} />前置完成后暂停给 AI 观察</label>}
      {selectedModule && moduleSummary.excluded.length > 0 && <p>本轮不执行：{moduleSummary.excluded.map(item=>item.id).join('、')}。<a href="#doc-cases">查看用例</a></p>}
    </details>
    <WebsiteDiscoveryPanel key={project.id} projectId={project.id} disabled={props.busy || !props.modelAvailable} />
  </section></React.Fragment>;
}
