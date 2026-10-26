import { useMemo, useState } from 'react';

type CaseDraft = { id: string; origin: 'existing' | 'ai-draft'; title: string; requirementIds: string[]; sourceRefs: string[]; scenarioType: string; priority: string; preconditions: string[]; testData: string[]; actions: string[]; expectedResult: string; confidence: string; clarificationNeeded: string[] };
type RequirementScope = 'in-scope' | 'out-of-scope' | 'deferred' | 'uncertain';
export type GenerationResult = { requirements: Array<{ id: string; text: string; source: string; priority: string; confidence: string; scopeStatus: RequirementScope; scopeRationale: string }>; cases: CaseDraft[]; coverageMatrix: Array<{ requirementId: string; scopeStatus: RequirementScope; coverageStatus: 'covered' | 'uncovered' | 'out-of-scope' | 'deferred' | 'uncertain'; aiCaseIds: string[]; referenceCaseIds: string[]; referenceStatus: 'covered' | 'partial' | 'uncovered' | 'uncertain'; rationale: string }>; quality: { duplicateCount: number; untracedCaseIds: string[]; clarificationCount: number; uncoveredByDraftsRequirementIds: string[]; aiDraftScore: { average: number; completeCases: number; assessedCases: number }; semanticReview: { average: number; strongCases: number; needsReviewCases: number; assessedCases: number; dimensions: Array<{ name: string; average: number; issueCount: number }>; cases: Array<{ aiCaseId: string; score: number; dimensions: { actionability: number; observability: number; grounding: number; atomicity: number; fixtureReadiness: number }; issues: string[] }> }; scopeSummary: { inScope: number; covered: number; uncovered: number; outOfScope: number; deferred: number; uncertain: number }; benchmarkComparison: { referenceCount: number; evaluatedCases: number; duplicateCandidates: number; overlapCount: number; novelCount: number; items: Array<{ aiCaseId: string; relation: 'duplicate' | 'overlap' | 'novel' | 'uncertain'; referenceCaseIds: string[]; rationale: string }> } }; warnings: string[]; sources: Array<{ kind: string; label: string; reference?: string }>; research?: { count: number; notice: string }; generationArtifact?: unknown };
type Upload = { name: string; bytesBase64: string; size: number; role: 'auto' | 'requirements' | 'coverage-reference' | 'held-out-benchmark' };

const scopeLabel = (value: RequirementScope) => ({ 'in-scope': '本期范围', 'out-of-scope': '本期不做', deferred: '后续版本', uncertain: '范围待确认' })[value];
const coverageLabel = (value: GenerationResult['coverageMatrix'][number]['coverageStatus']) => ({ covered: '已覆盖', uncovered: '未覆盖', 'out-of-scope': '本期不做', deferred: '后续版本', uncertain: '范围待确认' })[value];
const referenceLabel = (value: GenerationResult['coverageMatrix'][number]['referenceStatus']) => ({ covered: '基准高度对应', partial: '基准部分对应', uncovered: '未发现基准覆盖', uncertain: '无法判定' })[value];

async function encodeFile(file: File): Promise<Upload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { name: file.name, bytesBase64: btoa(binary), size: file.size, role: 'auto' };
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export default function CaseGeneratorPage({ modelAvailable, onTransfer }: { modelAvailable: boolean; onTransfer?: (generation: GenerationResult, targetUrl: string) => Promise<void> }) {
  const [requirements, setRequirements] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteText, setWebsiteText] = useState('');
  const [files, setFiles] = useState<Upload[]>([]);
  const [maxCases, setMaxCases] = useState(80);
  const [includeResearch, setIncludeResearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const sourceCount = useMemo(() => Number(!!requirements.trim()) + Number(!!websiteUrl.trim() || !!websiteText.trim()) + files.length, [requirements, websiteText, websiteUrl, files.length]);

  async function addFiles(list: FileList | File[]) {
    const accepted = Array.from(list).filter(file => /\.(pdf|xmind|md|markdown|txt)$/i.test(file.name)).slice(0, Math.max(0, 5 - files.length));
    const encoded = await Promise.all(accepted.map(encodeFile)); setFiles(current => [...current, ...encoded].slice(0, 5));
  }

  async function generate() {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/case-generator/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requirementsText: requirements, websiteUrl, websiteText, files: files.map(file => ({ fileName: file.name, bytesBase64: file.bytesBase64, role: file.role })), maxCases, searchExamples: includeResearch }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `生成失败（${response.status}）`);
      setResult(body as GenerationResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function transferToExecution() {
    if (!result || !websiteUrl.trim() || !onTransfer) return;
    setTransferring(true); setTransferError('');
    try { await onTransfer((result.generationArtifact && typeof result.generationArtifact === 'object' ? result.generationArtifact : result) as GenerationResult, websiteUrl.trim()); }
    catch (cause) { setTransferError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setTransferring(false); }
  }

  const aiCases = result?.cases.filter(item => item.origin === 'ai-draft') ?? [];
  const baselineCases = result?.cases.filter(item => item.origin === 'existing') ?? [];
  const benchmarkByCase = new Map(result?.quality.benchmarkComparison.items.map(item => [item.aiCaseId, item]) ?? []);
  const semanticByCase = new Map(result?.quality.semanticReview.cases.map(item => [item.aiCaseId, item]) ?? []);
  const report = result ? `# 独立生成的测试用例与基准比较\n\n需求数：${result.requirements.length} · 本期范围内：${result.quality.scopeSummary.inScope} · AI 独立生成：${aiCases.length} · 既有基准：${baselineCases.length}\n\n## 覆盖摘要\n\n- 范围内需求：${result.quality.scopeSummary.covered}/${result.quality.scopeSummary.inScope} 已关联 AI 用例\n- 未覆盖范围内需求：${result.quality.uncoveredByDraftsRequirementIds.join(', ') || '无'}\n- 范围外：${result.quality.scopeSummary.outOfScope} · 延期：${result.quality.scopeSummary.deferred} · 待确认：${result.quality.scopeSummary.uncertain}\n\n## AI 用例质量（第二轮语义审查）\n\n- 语义审查均分：${result.quality.semanticReview.assessedCases ? `${result.quality.semanticReview.average}%` : '未完成'} · 需复核 ${result.quality.semanticReview.needsReviewCases}/${result.quality.semanticReview.assessedCases}\n${result.quality.semanticReview.dimensions.map(item => `- ${item.name}：${result.quality.semanticReview.assessedCases ? `${item.average}%` : '未完成'}；需复核 ${item.issueCount} 条`).join('\n')}\n- 结构字段完整度：${result.quality.aiDraftScore.average}%（仅检查字段齐全，不代表业务正确性）\n- 与基准重复候选：${result.quality.benchmarkComparison.duplicateCandidates} · 部分重合：${result.quality.benchmarkComparison.overlapCount} · 未发现相似：${result.quality.benchmarkComparison.novelCount}\n\n## 逐需求覆盖矩阵\n\n| 需求 | 范围 | AI 覆盖 | 关联基准对照 | 对照 ID |\n|---|---|---|---|---|\n${result.coverageMatrix.map(item => `| ${item.requirementId} | ${scopeLabel(item.scopeStatus)} | ${coverageLabel(item.coverageStatus)} | ${referenceLabel(item.referenceStatus)} | ${item.referenceCaseIds.join(', ') || '—'} |`).join('\n')}\n\n## AI 独立生成用例\n\n${aiCases.map((item, index) => { const comparison = benchmarkByCase.get(item.id); const review = semanticByCase.get(item.id); return `### ${index + 1}. ${item.title}\n\n- ID：${item.id}\n- 类型：${item.scenarioType} · 优先级：${item.priority} · 置信度：${item.confidence}\n- 需求追溯：${item.requirementIds.join(', ') || '未关联'}\n- 来源引用（模型提供，待核验）：${item.sourceRefs.join('；') || '未标明'}\n- 前置条件：${item.preconditions.join('；') || '无'}\n- 测试数据：${item.testData.join('；') || '未指定'}\n- 操作步骤：\n${item.actions.map((step, i) => `  ${i + 1}. ${step}`).join('\n') || '  - 待补充'}\n- 预期结果：${item.expectedResult}\n- 待澄清：${item.clarificationNeeded.join('；') || '无'}\n- 语义审查：${review?.score ?? '未评估'}${review ? '%' : ''}${review?.issues.length ? `；${review.issues.join('；')}` : ''}\n- 基准比较：${comparison?.relation ?? '未评估'}；${comparison?.rationale ?? ''}；匹配 ID：${comparison?.referenceCaseIds.join(', ') || '无'}`; }).join('\n\n')}\n\n## 需求清单\n\n${result.requirements.map(item => `- **${item.id} · ${item.priority} · ${scopeLabel(item.scopeStatus)}** ${item.text}\n  - 来源引用（模型提供，待核验）：${item.source}\n  - 范围依据：${item.scopeRationale}\n  - 置信度：${item.confidence}`).join('\n')}\n\n## 基准用例（原样保留，仅用于生成后比较）\n\n${baselineCases.map(item => `- ${item.id} · ${item.title} → ${item.expectedResult}`).join('\n')}\n\n## 其他检查\n\n- 待澄清项总数（包括基准原用例）：${result.quality.clarificationCount}\n- AI 用例缺少来源：${result.quality.untracedCaseIds.join(', ') || '无'}\n- AI 草稿内部完全重复过滤：${result.quality.duplicateCount}\n\n## 生成限制\n\n${result.warnings.map(item => `- ${item}`).join('\n') || '- 无'}\n\n## 来源\n\n${result.sources.map(item => `- ${item.label}${item.reference ? `：${item.reference}` : ''}`).join('\n')}\n\n${result.research ? `公开案例参考：${result.research.count} 条。${result.research.notice}\n` : ''}\n> 基准用例未传入生成阶段。语义审查和相似度评估是 AI 复核信号，仍需人工确认；本产物不包含自动化脚本，也未执行测试。\n` : '';

  return <div className="main-column casegen-page">
    <div className="page-heading"><div><div className="eyebrow">TEST DESIGN · GENERATION ONLY</div><h1>测试用例生成 Agent</h1><p>AI 先根据需求独立生成；范围内需求优先覆盖，旧用例只在生成后做质量和覆盖对照。</p></div><span className={`casegen-model ${modelAvailable ? 'ready' : ''}`}><i/>{modelAvailable ? '模型已连接' : '请先配置模型'}</span></div>
    <section className="casegen-layout">
      <div className="casegen-inputs">
        <div className="casegen-input-card"><label htmlFor="casegen-requirements">需求 / 补充说明 <span>可选</span></label><textarea id="casegen-requirements" value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="粘贴产品需求、用户故事、验收标准或你特别关注的测试范围…" rows={7}/></div>
        <div className="casegen-input-card"><label htmlFor="casegen-url">网站网址 <span>读取公开页面；也可粘贴登录后内容</span></label><input id="casegen-url" type="url" value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} placeholder="https://example.com"/><textarea value={websiteText} onChange={event => setWebsiteText(event.target.value)} placeholder="可以粘贴页面中的产品说明、导航、表单字段或业务规则。公开静态网页会尝试只读抓取；登录页或 JavaScript 应用请粘贴已登录页面的可见内容。" rows={4}/></div>
        <div className="casegen-input-card"><label>需求文档 / 比较基准 <span>PDF · XMind · Markdown · TXT，最多 5 个</span></label><label className="casegen-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}><b>＋ 添加资料</b><span>逐份标明用途；留出基准仅在生成后参与比较</span><input type="file" multiple accept=".pdf,.xmind,.md,.markdown,.txt" onChange={event => { void addFiles(event.target.files ?? []); event.target.value = ''; }}/></label>{files.map((file, index) => <div className="casegen-file" key={`${file.name}-${index}`}><span>{file.name}</span><select aria-label={`${file.name} 的用途`} value={file.role} onChange={event => setFiles(current => current.map((item, i) => i === index ? { ...item, role: event.target.value as Upload['role'] } : item))}><option value="auto">自动识别</option><option value="requirements">需求资料</option><option value="coverage-reference">覆盖参考</option><option value="held-out-benchmark">留出基准（只做事后比较）</option></select><small>{Math.ceil(file.size / 1024)} KB</small><button type="button" onClick={() => setFiles(current => current.filter((_, i) => i !== index))} aria-label={`移除 ${file.name}`}>×</button></div>)}</div>
        <details className="casegen-options"><summary>生成选项</summary><label>新增候选用例上限 <select value={maxCases} onChange={event => setMaxCases(Number(event.target.value))}><option value={30}>30</option><option value={50}>50</option><option value={80}>80（推荐，留足需求补齐空间）</option></select></label><label><input type="checkbox" checked={includeResearch} onChange={event => setIncludeResearch(event.target.checked)}/> 搜索公开案例作为覆盖启发</label></details>
        {error && <div className="casegen-error" role="alert">{error}</div>}
        <button className="button-primary casegen-submit" disabled={busy || !modelAvailable || sourceCount === 0} onClick={() => void generate()}>{busy ? <><span className="casegen-spinner"/>正在生成、补齐并复核…</> : '生成并检查测试用例'}</button>
        <p className="casegen-boundary">只生成、整理和检查用例。不会打开目标网站、生成脚本或执行测试。未知业务规则会标记待澄清。</p>
      </div>
      <div className="casegen-results">
        {!result && <div className="casegen-empty"><div className="casegen-empty-icon">✓</div><h2>生成结果将在这里显示</h2><p>先基于需求独立生成，再用留出的旧用例做事后对照，检查覆盖、相似场景和用例结构质量。</p><div className="casegen-steps"><span>01 <b>提取需求</b></span><span>02 <b>独立生成</b></span><span>03 <b>基准比较</b></span></div></div>}
        {result && <><div className="casegen-result-head"><div><div className="eyebrow">DRAFT · 待审核</div><h2>独立生成与基准比较</h2><p>{result.requirements.length} 项需求 · 范围内 {result.quality.scopeSummary.covered}/{result.quality.scopeSummary.inScope} 已覆盖 · {aiCases.length} 条 AI 用例 · {baselineCases.length} 条基准</p></div><div className="casegen-downloads"><button className="button-secondary" onClick={() => download('test-cases.json', JSON.stringify(result, null, 2), 'application/json')}>导出 JSON</button><button className="button-secondary" onClick={() => download('test-cases.md', report, 'text/markdown;charset=utf-8')}>导出 Markdown</button></div></div>
          {onTransfer && <section className="casegen-handoff"><div><b>继续执行这批 AI 用例</b><p>只移交 AI 生成用例；项目会以未审核草稿创建。旧用例仍只用于生成后对照，浏览器步骤必须再经审核和只读安全检查。</p></div><button className="button-primary" disabled={transferring || !websiteUrl.trim() || aiCases.length === 0} onClick={() => void transferToExecution()}>{transferring ? '正在移交…' : '移交到测试执行'}</button>{transferError && <p className="casegen-error" role="alert">{transferError}</p>}{!websiteUrl.trim() && <small>先填写网站网址，才能建立执行项目。</small>}</section>}
          <div className="casegen-quality"><div><strong>{result.quality.semanticReview.assessedCases ? `${result.quality.semanticReview.average}%` : '—'}</strong><span>语义审查均分</span></div><div><strong>{result.quality.scopeSummary.uncovered}</strong><span>范围内未覆盖需求</span></div><div><strong>{result.quality.semanticReview.needsReviewCases}</strong><span>需人工复核用例</span></div><div><strong>{result.quality.benchmarkComparison.duplicateCandidates}</strong><span>基准重复候选</span></div></div>
          <div className="casegen-review-dimensions">{result.quality.semanticReview.dimensions.map(item => <span key={item.name}><b>{item.name}</b>{result.quality.semanticReview.assessedCases ? `${item.average}%` : '未完成'} · {item.issueCount} 项待改</span>)}</div>
          <p className="casegen-note">结构完整度 {result.quality.aiDraftScore.average}%（只核字段齐全）；语义审查为 AI 二次评估信号，不代表业务正确性。范围外 {result.quality.scopeSummary.outOfScope} · 延期 {result.quality.scopeSummary.deferred} · 待确认 {result.quality.scopeSummary.uncertain}。</p>
          {result.warnings.map((warning, index) => <p className="casegen-warning" key={index}>! {warning}</p>)}
          <section className="casegen-benchmark"><h3>生成后独立对照</h3><p>基准没有参与 AI 生成。比较结果用于定位重复和覆盖差异；“新场景”不是正确性结论。</p><div className="casegen-benchmark-list">{result.quality.benchmarkComparison.items.map(item => { const draft = aiCases.find(testCase => testCase.id === item.aiCaseId); return <article key={item.aiCaseId}><b>{draft?.title ?? item.aiCaseId}</b><span>{({ duplicate: '疑似重复', overlap: '部分重合', novel: '未发现相似基准', uncertain: '需人工判断' } as const)[item.relation]}</span><p>{item.rationale}</p>{item.referenceCaseIds.length > 0 && <small>对照：{item.referenceCaseIds.join(', ')}</small>}</article>; })}{result.quality.benchmarkComparison.items.length === 0 && <p>没有可用基准，或事后比较未完成。</p>}</div></section>
          <details className="casegen-requirement-list casegen-coverage-list"><summary>逐需求覆盖矩阵（范围内 {result.quality.scopeSummary.covered}/{result.quality.scopeSummary.inScope} · 范围外 {result.quality.scopeSummary.outOfScope} · 延期 {result.quality.scopeSummary.deferred}）</summary><p className="casegen-note">AI 覆盖按需求关联判断。基准列根据关联 AI 用例的比较结果推断；没有关联 AI 用例时显示“无法判定”，不代表已独立审完全部旧用例。</p>{result.coverageMatrix.map(row => { const req = result.requirements.find(item => item.id === row.requirementId); return <div key={row.requirementId}><b>{row.requirementId} · {scopeLabel(row.scopeStatus)}</b><span>{coverageLabel(row.coverageStatus)} · AI 用例 {row.aiCaseIds.map(id => aiCases.find(item => item.id === id)?.title ?? id).join('；') || '无'}</span><small>{referenceLabel(row.referenceStatus)}：{row.referenceCaseIds.join(', ') || '未匹配'} · {req?.text} · {req?.scopeRationale}</small></div>; })}</details>
          <h3 className="casegen-subheading">AI 独立生成的用例</h3>
          <div className="casegen-case-list">{aiCases.map((item, index) => { const review = semanticByCase.get(item.id); return <article className="casegen-case" key={item.id}><header><span className="casegen-index">{String(index + 1).padStart(2, '0')}</span><h3>{item.title}</h3><span className="casegen-origin origin-ai-draft">AI 草稿</span><span className={`casegen-priority priority-${item.priority.toLowerCase()}`}>{item.priority}</span></header><div className="casegen-case-meta"><span>{item.scenarioType}</span><span>语义审查 {review?.score ?? '—'}%</span><span>{item.requirementIds.join(', ') || '未关联需求'}</span></div><p><b>预期结果</b>{item.expectedResult}</p><details><summary>查看步骤、前置条件、审查问题和来源</summary><ol>{item.actions.map((step, i) => <li key={i}>{step}</li>)}</ol><p><b>前置条件：</b>{item.preconditions.join('；') || '无'}</p><p><b>测试数据：</b>{item.testData.join('；') || '未指定'}</p><p><b>来源引用（AI 提供，待核验）：</b>{item.sourceRefs.join('；') || '未标明'}</p>{review?.issues.length ? <p className="casegen-clarification"><b>审查发现：</b>{review.issues.join('；')}</p> : null}{item.clarificationNeeded.length > 0 && <p className="casegen-clarification"><b>需要澄清：</b>{item.clarificationNeeded.join('；')}</p>}</details></article>; })}</div>
          <details className="casegen-requirement-list"><summary>留出基准原用例（{baselineCases.length}，不参与生成）</summary>{baselineCases.map(item => <div key={item.id}><b>{item.id}</b><span>{item.title} · {item.expectedResult}</span><small>{item.sourceRefs.join('；')}</small></div>)}</details>
          <details className="casegen-requirement-list"><summary>需求清单（{result.requirements.length}）</summary>{result.requirements.map(item => <div key={item.id}><b>{item.id} · {item.priority} · {scopeLabel(item.scopeStatus)}</b><span>{item.text}</span><small>{item.source} · 范围依据：{item.scopeRationale}</small></div>)}</details>
        </>}
      </div>
    </section>
  </div>;
}

