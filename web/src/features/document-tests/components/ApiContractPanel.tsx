import { canSelectCaseForRun } from '../case-selection';
import { suggestApiMappingCandidates } from '../../../api-mapping-candidates';
import type { ApiContract, ApiSuiteCandidate, ApiSuiteSummary, Project } from '../types';

export function ApiContractPanel(props: {
  project: Project;
  busy: boolean;
  loading: boolean;
  error: string;
  suites: ApiSuiteSummary[];
  detail: ApiSuiteCandidate | null;
  onChooseSuite(suiteId: string): void;
  onUpdateContract(contract: ApiContract): void;
  onSetMapping(documentCaseId: string, apiCaseId: string, checked: boolean): void;
  onSave(): void;
}) {
  const { project, busy, loading, error, suites, detail, onChooseSuite, onUpdateContract, onSetMapping, onSave } = props;
  return <details className="doc-api-contract">
    <summary>API 契约 <span>{project.apiContract?.suiteId ? '已关联' : '可选'}</span></summary>
    <p>只映射已审核的 API 套件；候选项需人工确认。</p>
    {error && <div className="doc-notice error">无法读取 API suite：{error}</div>}
    <label className="doc-api-suite-select">已审核 API suite
      <select aria-label="已审核 API suite" value={project.apiContract?.suiteId ?? ''} disabled={loading && suites.length === 0} onChange={event => onChooseSuite(event.target.value)}>
        <option value="">不关联 API suite</option>
        {suites.map(item => <option key={item.id} value={item.id}>{item.suiteName} · {item.caseCount} 条 · v{item.revision}</option>)}
        {project.apiContract?.suiteId && !suites.some(item => item.id === project.apiContract?.suiteId) && <option value={project.apiContract.suiteId}>当前关联候选（未在已审核列表中）</option>}
      </select>
      {loading && <small>正在读取候选…</small>}
      {!loading && suites.length === 0 && <small>暂无已审核套件。请先在“新建测试 → API 服务”导入并审核；不要猜接口。</small>}
    </label>
    {project.apiContract?.suiteId && detail?.id === project.apiContract.suiteId && detail.status === 'approved' && <>
      <div className="doc-api-suite-meta"><strong>{detail.suite.name}</strong><span>{detail.suite.cases.length} 条 API case · SHA-256 {detail.digest.slice(0, 12)}…</span></div>
      <div className="doc-api-authorizations" aria-label="API 执行单独授权">
        <label className="review-policy doc-api-network"><input type="checkbox" checked={project.apiContract?.allowNetwork === true} onChange={event => onUpdateContract({ ...project.apiContract, allowNetwork: event.target.checked, mappings: project.apiContract?.mappings ?? [] })} /><span>允许访问非本机 API 目标</span></label>
        <label className="review-policy doc-api-network"><input type="checkbox" checked={project.apiContract?.allowMutations === true} onChange={event => onUpdateContract({ ...project.apiContract, allowMutations: event.target.checked, mappings: project.apiContract?.mappings ?? [] })} /><span>允许执行已审核 suite 声明的 POST / PUT / PATCH / DELETE 与 fixture 生命周期请求</span></label>
        <label className="review-policy doc-api-network"><input type="checkbox" checked={project.apiContract?.allowConcurrency === true} onChange={event => onUpdateContract({ ...project.apiContract, allowConcurrency: event.target.checked, mappings: project.apiContract?.mappings ?? [] })} /><span>允许执行已审核 suite 声明的并发请求</span></label>
      </div>
      <small className="doc-api-help">授权默认关闭；写请求仅用于隔离、可清理的测试环境。</small>
      <div className="doc-api-mapping-list" aria-label="文档用例到 API case 映射">
        {project.cases.map(item => {
          const mapped = project.apiContract?.mappings?.find(entry => entry.documentCaseId === item.id)?.apiCaseIds ?? [];
          const candidates = suggestApiMappingCandidates(item, detail.suite.cases);
          const candidateIds = new Set(candidates.map(candidate => candidate.id));
          return <fieldset className="doc-api-mapping" key={item.id}>
            <legend>{!canSelectCaseForRun(item) ? `${item.lifecycleStatus === 'disabled' ? '已停用' : '草稿'} · ` : item.selectedForRegression === false ? '本轮不执行 · ' : ''}{item.id} · {item.title}</legend>
            {candidates.length > 0 && <small className="doc-api-help">映射候选（需人工核对）：{candidates.map(candidate => candidate.id).join('、')}</small>}
            {detail.suite.cases.map(apiCase => <label key={apiCase.id} className={`doc-api-case-option ${candidateIds.has(apiCase.id) ? 'mapping-candidate' : ''}`}><input type="checkbox" checked={mapped.includes(apiCase.id)} onChange={event => onSetMapping(item.id, apiCase.id, event.target.checked)} /><span><strong>{apiCase.id}</strong> · {apiCase.title}{candidateIds.has(apiCase.id) && <em>映射候选 · 仅供参考</em>}<small>{apiCase.request.method} {apiCase.request.path}</small></span></label>)}
            {mapped.length === 0 && <small className="doc-api-unmapped">尚未映射；不会为此文档用例执行 API 请求。</small>}
          </fieldset>;
        })}
        {!project.cases.length && <small>项目还没有文档测试用例。</small>}
      </div>
    </>}
    {project.apiContract?.suiteId && !loading && (detail?.id !== project.apiContract.suiteId || detail.status !== 'approved') && <div className="doc-notice error">关联的 suite 尚未通过审核，或当前无法读取。只有已审核且可读取的套件才能映射。</div>}
    <div className="doc-api-actions"><button className="button-secondary" disabled={busy} onClick={onSave}>保存 API 映射与安全选项</button><small>保存会调用项目更新接口并遵循项目当前的审核/确认策略；修改后需要按项目策略重新审核。</small></div>
  </details>;
}
