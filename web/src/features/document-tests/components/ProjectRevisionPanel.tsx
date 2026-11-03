import React from 'react';
import type { Project, ProjectRevisionKind, ProjectRevisionSummary } from '../types';

type RevisionDetail = { snapshot: unknown };

type CaseGenerationSnapshot = {
  artifactId?: string;
  version?: number;
  requirements?: Array<{ id?: string; text?: string; source?: string; priority?: string; scopeStatus?: string; scopeRationale?: string }>;
  provenance?: {
    status?: string;
    requirementsTextSha256?: string;
    websiteTextSha256?: string;
    websiteSource?: string;
    websiteReference?: string;
    uploadedFiles?: Array<{ fileName?: string; role?: string; bytesSha256?: string; extractedTextSha256?: string }>;
    researchSources?: Array<{ url?: string; snippetSha256?: string }>;
  };
  warnings?: string[];
  transferredCases?: Array<{ sourceCaseId?: string; projectCaseId?: string; revisionId?: string; digest?: string }>;
  stepEvidenceRevisionIds?: string[];
  reviewStatus?: string;
};

function isCaseGenerationSnapshot(value: unknown): value is CaseGenerationSnapshot {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as CaseGenerationSnapshot).artifactId === 'string'
    && Array.isArray((value as CaseGenerationSnapshot).requirements)
    && Array.isArray((value as CaseGenerationSnapshot).transferredCases));
}

function CaseGenerationRevisionSnapshot({ snapshot }: { snapshot: unknown }) {
  if (!isCaseGenerationSnapshot(snapshot)) return <pre>{JSON.stringify(snapshot, null, 2)}</pre>;
  const provenance = snapshot.provenance;
  const provenanceLabel = provenance?.status === 'captured' ? '来源摘要已记录' : '来源摘要缺失 · 旧生成结果';
  const websiteSourceLabel = ({ 'provided-text': '手动提供页面文字', 'public-read': '公开页面读取', missing: '未提供页面文字' } as Record<string, string>)[provenance?.websiteSource ?? ''] ?? '来源未说明';
  const candidates = snapshot.transferredCases ?? [];
  const requirements = snapshot.requirements ?? [];
  const uploads = provenance?.uploadedFiles ?? [];
  const researchSources = provenance?.researchSources ?? [];
  const warnings = snapshot.warnings ?? [];
  return <div className="doc-generation-snapshot">
    <div className="doc-generation-snapshot__facts" aria-label="生成批次摘要">
      <div><strong>需求</strong><span>{requirements.length} 条</span></div>
      <div><strong>候选用例</strong><span>{candidates.length} 条</span></div>
      <div><strong>审核状态</strong><span>{snapshot.reviewStatus === 'approved' ? '已审核' : '待人工审核'}</span></div>
      <div><strong>步骤依据</strong><span>{snapshot.stepEvidenceRevisionIds?.length ?? 0} 项</span></div>
    </div>
    <dl className="doc-generation-snapshot__provenance">
      <div><dt>输入来源</dt><dd>{provenanceLabel}</dd></div>
      <div><dt>需求文本摘要</dt><dd>{provenance?.requirementsTextSha256 ? <code>{provenance.requirementsTextSha256}</code> : '未记录'}</dd></div>
      <div><dt>页面文字</dt><dd>{websiteSourceLabel}{provenance?.websiteTextSha256 && <> · <code>{provenance.websiteTextSha256}</code></>}</dd></div>
      {provenance?.websiteReference && <div><dt>页面来源</dt><dd>{provenance.websiteReference}</dd></div>}
    </dl>
    <details className="doc-generation-snapshot__details">
      <summary>查看需求与候选版本关联</summary>
      <div className="doc-generation-snapshot__lists">
        <section><h3>需求与范围</h3>{requirements.length ? <ul>{requirements.map((item, index) => <li key={`${item.id ?? 'requirement'}-${index}`}><strong>{item.id || `需求 ${index + 1}`} · {item.priority || '优先级未记录'} · {item.scopeStatus || '范围未记录'}</strong><span>{item.text || '需求正文未记录'}</span>{item.source && <small>来源：{item.source}</small>}{item.scopeRationale && <small>范围依据：{item.scopeRationale}</small>}</li>)}</ul> : <p>此批次没有需求条目。</p>}</section>
        <section><h3>候选版本</h3>{candidates.length ? <ul>{candidates.map((item, index) => <li key={`${item.projectCaseId ?? 'candidate'}-${index}`}><strong>{item.sourceCaseId || '来源用例未记录'} → {item.projectCaseId || '项目用例未记录'}</strong><small>{item.revisionId ? `修订 ${item.revisionId}` : '用例修订未关联'}{item.digest ? ` · SHA-256 ${item.digest}` : ''}</small></li>)}</ul> : <p>此批次没有转入候选用例。</p>}</section>
      </div>
    </details>
    {(uploads.length > 0 || researchSources.length > 0 || warnings.length > 0) && <details className="doc-generation-snapshot__details">
      <summary>查看资料摘要与生成提醒</summary>
      {uploads.length > 0 && <section><h3>上传资料摘要</h3><ul>{uploads.map((item, index) => <li key={`${item.fileName ?? 'file'}-${index}`}><strong>{item.fileName || `资料 ${index + 1}`} · {item.role || '用途未记录'}</strong><small>文件 SHA-256：{item.bytesSha256 || '未记录'} · 抽取文字 SHA-256：{item.extractedTextSha256 || '未记录'}</small></li>)}</ul></section>}
      {researchSources.length > 0 && <section><h3>公开参考摘要</h3><ul>{researchSources.map((item, index) => <li key={`${item.url ?? 'source'}-${index}`}><span>{item.url || '来源地址未记录'}</span><small>片段 SHA-256：{item.snippetSha256 || '未记录'}</small></li>)}</ul></section>}
      {warnings.length > 0 && <section><h3>生成提醒</h3><ul>{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></section>}
    </details>}
  </div>;
}

export function ProjectRevisionPanel(props: {
  project: Project;
  busy: boolean;
  materials: {
    file: File | null; setFile(file: File | null): void;
    role: 'requirements' | 'coverage-reference' | 'held-out-benchmark';
    setRole(role: 'requirements' | 'coverage-reference' | 'held-out-benchmark'): void;
    replacementId: string; setReplacementId(id: string): void;
    save(): Promise<void>;
  };
  revisions: {
    total: number; kind: ProjectRevisionKind | ''; setKind(kind: ProjectRevisionKind | ''): void;
    entity: string; setEntity(entity: string): void; offset: number; loading: boolean; error: string;
    items: ProjectRevisionSummary[]; snapshots: Record<string, RevisionDetail | undefined>; busyId: string;
    toggle(item: ProjectRevisionSummary): Promise<unknown>;
    restoreSteps(item: ProjectRevisionSummary): Promise<unknown>;
    loadMore(offset: number): Promise<unknown>;
  };
}) {
  const { project, materials, revisions, busy } = props;
  const revisionKindLabels: Record<ProjectRevisionKind, string> = { case: '用例', steps: '执行步骤', 'step-evidence': '步骤生成依据', 'case-set': '用例清单', 'case-generation': '用例生成批次', materials: '测试资料', 'test-data': '测试数据组' };
  const availableMaterials = (project.sourceMaterials ?? []).filter(item => item.role !== 'website-content');
  return <React.Fragment><details className="doc-revision-disclosure" id="doc-revisions">
    <summary>项目修订历史 <span>{revisions.total} 条</span></summary>
    <section className="doc-site-version-card doc-revision-card">
      <div className="doc-section-head"><div><h2>用例、步骤、生成依据与资料修订</h2><p>保存项目时自动留存不可覆盖的快照；步骤生成依据只读查看，不支持恢复；运行开始时的快照仍以运行记录为准。资料正文保存在本机修订存储中。</p></div><span className="table-status status-passed">{revisions.total} 条修订</span></div>
      <details className="doc-material-upload">
        <summary>追加或替换项目资料</summary>
        <p>支持 PDF、XMind、Markdown、TXT，单份最多 9 MB。更新后会新增资料版本并将项目转为待审核；正式用例和历史运行不会被自动改写。</p>
        <div className="doc-material-upload-fields">
          <label>资料操作<select aria-label="资料操作" value={materials.replacementId} onChange={event => {
            const id = event.target.value; materials.setReplacementId(id);
            const material = project.sourceMaterials?.find(item => item.id === id);
            if (material && ['requirements', 'coverage-reference', 'held-out-benchmark'].includes(material.role)) materials.setRole(material.role as 'requirements' | 'coverage-reference' | 'held-out-benchmark');
          }}><option value="">新增资料</option>{availableMaterials.map(item => <option key={item.id} value={item.id}>替换：{item.fileName} · {item.role}</option>)}</select></label>
          <label>资料用途<select aria-label="资料用途" value={materials.role} onChange={event => materials.setRole(event.target.value as 'requirements' | 'coverage-reference' | 'held-out-benchmark')}><option value="requirements">需求资料</option><option value="coverage-reference">覆盖参考</option><option value="held-out-benchmark">留出基准</option></select></label>
          <label>新资料文件<input type="file" accept=".pdf,.xmind,.md,.markdown,.txt" onChange={event => { const next = event.target.files?.[0] ?? null; event.currentTarget.value = ''; materials.setFile(next); }} /><small>{materials.file ? materials.file.name + ' · ' + Math.ceil(materials.file.size / 1024) + ' KB' : '选好文件后保存为该项目的新资料版本。'}</small></label>
          <button className="button-secondary" disabled={busy || !materials.file || (!materials.replacementId && availableMaterials.length >= 5)} onClick={() => void materials.save()}>{busy ? '正在保存…' : materials.replacementId ? '保存替换版本' : '加入项目资料'}</button>
        </div>
      </details>
      <div className="doc-revision-filters">
        <label>类型<select aria-label="修订类型" value={revisions.kind} onChange={event => revisions.setKind(event.target.value as ProjectRevisionKind | '')}><option value="">全部</option><option value="case">用例</option><option value="steps">执行步骤</option><option value="step-evidence">步骤生成依据</option><option value="case-set">用例清单</option><option value="case-generation">用例生成批次</option><option value="materials">测试资料</option><option value="test-data">测试数据组</option></select></label>
        <label>用例 / 数据组 ID<input aria-label="修订实体 ID" value={revisions.entity} disabled={!revisions.kind || revisions.kind === 'materials' || revisions.kind === 'case-set'} onChange={event => revisions.setEntity(event.target.value.replace(/[^A-Za-z0-9_.:-]/gu, '').replace(/^[^A-Za-z0-9]+/gu, '').slice(0, 80))} placeholder="筛选具体用例或数据组" /></label>
      </div>
      {revisions.error && <p className="doc-notice error">读取修订失败：{revisions.error}</p>}
      {revisions.loading && <p className="doc-notice">正在读取修订历史…</p>}
      {!revisions.loading && !revisions.error && revisions.items.length === 0 && <p className="doc-notice">当前筛选没有修订记录；保存项目后会自动记录用例、步骤、页面生成依据和资料快照。</p>}
      <div className="doc-revision-list">{revisions.items.map(revision => {
        const detail = revisions.snapshots[revision.id];
        const kindLabel = revisionKindLabels[revision.kind];
        return <article key={revision.id}>
          <div><strong>{kindLabel} · {revision.summary}</strong><small>{revision.kind === 'case-set' || revision.kind === 'materials' ? '' : 'ID ' + revision.entityId + ' · '}v{revision.version} · {new Date(revision.createdAt).toLocaleString()}</small><small>来源：{revision.source === 'run-snapshot' ? '旧运行快照回填' : '项目保存'} · SHA-256 {revision.digest}</small></div>
          <button className="text-button" disabled={revisions.busyId === revision.id} onClick={() => void revisions.toggle(revision)}>{revisions.busyId === revision.id ? '校验中…' : detail ? '隐藏快照' : '查看快照'}</button>
          {revision.kind === 'steps' && <button className="text-button" disabled={busy || revisions.busyId === revision.id} onClick={() => {
            const confirmed = window.confirm(`将用历史版本 v${revision.version} 替换用例 ${revision.entityId} 的当前执行步骤。预期和其他字段不变；用例会取消回归选择并转为待审核，且不会自动运行。确定恢复吗？`);
            if (confirmed) void revisions.restoreSteps(revision);
          }}>恢复此步骤版本</button>}
          {detail && (revision.kind === 'case-generation'
            ? <CaseGenerationRevisionSnapshot snapshot={detail.snapshot} />
            : <pre>{JSON.stringify(detail.snapshot, null, 2)}</pre>)}
        </article>;
      })}</div>
      {revisions.offset < revisions.total && <button className="button-secondary" disabled={revisions.loading} onClick={() => void revisions.loadMore(revisions.offset)}>{revisions.loading ? '读取中…' : '加载更多（' + revisions.offset + '/' + revisions.total + '）'}</button>}
    </section>
  </details></React.Fragment>;
}
