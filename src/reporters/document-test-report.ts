import { caseCategoryLabels } from "../adapters/document-test-types.js";
import type { BaselineDisposition, BrowserCheck, CaseComparison, DocumentBaselineComparison, DocumentCaseTriageCategory, DocumentProject, DocumentRun, ExecutionRoute } from "../domain/document-test-model.js";

type LaneResult = DocumentRun["deterministic"];
type CaseResult = LaneResult["results"][number];
type CaseExecutionPlanner = (item: Pick<BrowserCheck, "title" | "source" | "expected" | "steps" | "coverageGap" | "confidence">) => { route: ExecutionRoute; reason: string; nextAction: string };

export function recoveryAdoptionReportLines(run: Pick<DocumentRun, 'checkpointRecovery'>): string[] {
  const adoption = run.checkpointRecovery?.adoptedAdvice;
  if (!adoption) return [];
  const text = (value: string) => value.replace(/[\\`*_{}[\]()#+.!|>~\-]/gu, '\\$&').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/[\r\n]+/gu, ' ');
  return [
    run.checkpointRecovery?.trigger === 'automatic-policy'
      ? '- 本次由自动恢复策略 v1 采纳调查建议，仅尝试一次；建议仍待验证，执行结果以本轮实际记录为准。'
      : '- 本次人工恢复采纳了调查建议；建议仍待验证，执行结果以本轮实际记录为准。',
    `- 调查记录：${text(adoption.recordId)}；用例：${text(adoption.caseId)}；采纳时间：${text(adoption.adoptedAt)}`,
    `- 调查事实摘要：${text(adoption.runDigest)}`,
    `- 采纳建议：${text(adoption.summary)}`,
    ...adoption.evidence.map(ref => `- 同用例事实 ${text(ref.factId)}：${text(ref.quote)}`),
  ];
}

/** One report outcome for the browser/API lanes of a regression case. */
function regressionReportOutcome(item: CaseComparison): "通过" | "失败" | "未验证" | "N/A" | "已取消" | "未运行" {
  if (item.deterministic === "cancelled" || item.apiContract === "cancelled") return "已取消";
  if (item.deterministic === "not-run" || item.apiContract === "not-run") return "未运行";
  if (item.resolution === "unresolved") return "未验证";
  if (item.resolution === "not-applicable") return "N/A";
  if ((item.deterministic === "passed" || (item.deterministic === "not-applicable" && item.apiContract === "passed"))
      && (!item.apiContract || item.apiContract === "passed")) return "通过";
  return "失败";
}

export function reportMarkdown(project: DocumentProject, run: DocumentRun, aiSummary: string, planCaseExecution: CaseExecutionPlanner): string {
  const scopeLabelFor = (id: string) => run.scopePlan
    ? run.scopePlan.targetCaseIds.includes(id) ? "直接目标"
      : run.scopePlan.impactCaseIds.includes(id) ? "关联影响"
        : run.scopePlan.prerequisiteCaseIds?.includes(id) ? "自动前置" : "范围未分类"
    : run.caseScopeKnown === false ? "历史范围未标注" : "目标/影响未标注";
  const scopeTagFor = (id: string) => `[${scopeLabelFor(id)}] `;
  const countsFor = (results: CaseResult[]) => {
    const counts = { passed: 0, failed: 0, blocked: 0, cancelled: 0, notRun: 0, notApplicable: 0 };
    for (const item of results) {
      if (item.status === "passed") counts.passed++;
      else if (item.status === "failed") counts.failed++;
      else if (item.status === "blocked") counts.blocked++;
      else if (item.status === "cancelled") counts.cancelled++;
      else if (item.status === "not-run") counts.notRun++;
      else counts.notApplicable++;
    }
    return counts;
  };
  const lane = (name: string, value: LaneResult, selectedIds: string[]) => {
    const actual = new Map(value.results.map(item => [item.id, item]));
    const scoped = value.results.filter(item => selectedIds.includes(item.id));
    const counts = countsFor(scoped);
    const missing = selectedIds.filter(id => !actual.has(id));
    return [
      `## ${name}：${value.status}`, "", value.summary,
      `- 本轮选中用例结果数：${scoped.length}/${selectedIds.length}；通过 ${counts.passed}、失败 ${counts.failed}、阻塞 ${counts.blocked}、取消 ${counts.cancelled}、未运行 ${counts.notRun}、N/A ${counts.notApplicable}。`,
      `- 有逐用例执行明细：${scoped.length}/${selectedIds.length}；缺少结果：${missing.join(", ") || "无"}。`, "",
      ...scoped.map(item => `- ${scopeTagFor(item.id)}[${item.status}] ${item.id} ${item.title} — ${item.detail}${Number.isFinite(item.durationMs) ? `（${item.durationMs} ms）` : ""}`),
      ...(missing.length ? missing.map(id => `- ${scopeTagFor(id)}[missing] ${id}：本 lane 未返回逐用例结果，不能据此记为通过。`) : []), "",
    ];
  };
  const selectedIds = run.caseScope.selectedCaseIds;
  const selectedSet = new Set(selectedIds);
  const excluded = project.cases.filter(item => !selectedSet.has(item.id));
  const selectedCases = project.cases.filter(item => selectedSet.has(item.id));
  const comparisonCounts = { aligned: 0, mismatch: 0, unresolved: 0, notApplicable: 0, missing: 0 };
  const comparisonById = new Map(run.comparisons.map(item => [item.id, item]));
  for (const id of selectedIds) {
    const resolution = comparisonById.get(id)?.resolution ?? "unresolved";
    if (resolution === "aligned") comparisonCounts.aligned++;
    else if (resolution === "mismatch") comparisonCounts.mismatch++;
    else if (resolution === "not-applicable") comparisonCounts.notApplicable++;
    else comparisonCounts.unresolved++;
    if (!comparisonById.has(id)) comparisonCounts.missing++;
  }
  const baselineDispositionLabels: Record<BaselineDisposition, string> = { regression: "疑似回归", fixed: "已修复", unchanged: "未变化", "case-changed": "用例已修改，需复核", added: "新增用例", removed: "用例已移除", "not-run": "未运行", "no-baseline-result": "基线无结果", unresolved: "无法比较" };
  const triageCategoryLabels: Record<DocumentCaseTriageCategory, string> = { "suspected-product-regression": "疑似产品回归", "case-or-expectation-review": "用例或预期需复核", "locator-failure": "元素定位失效", "environment-or-session": "环境或登录会话问题", "test-data-or-fixture": "测试数据或 fixture 问题", "needs-review": "待确认" };
  const baselineStatusLabel = (status?: CaseResult["status"]) => status ? ({ passed: "通过", failed: "失败", blocked: "阻塞", cancelled: "取消", "not-run": "未运行", "not-applicable": "不适用" }[status]) : "无结果";
  const baselineDispositionCounts = run.baselineComparison?.reduce<Record<string, number>>((counts, item) => { counts[item.disposition] = (counts[item.disposition] ?? 0) + 1; return counts; }, {}) ?? {};
  const baselineRunScopeLabel = (caseId: string) => {
    const scope = run.baselineRunSnapshot?.scopePlan;
    if (!scope) return "旧版范围未标注";
    if (scope.targetCaseIds.includes(caseId)) return "直接目标";
    if (scope.impactCaseIds.includes(caseId)) return "关联影响";
    if (scope.prerequisiteCaseIds?.includes(caseId)) return "自动前置";
    return "基线未选";
  };
  const currentRunScopeLabel = (item: DocumentBaselineComparison) => item.disposition === "removed" ? "已从当前项目移除"
    : run.scopePlan?.targetCaseIds.includes(item.caseId) ? "直接目标"
      : run.scopePlan?.impactCaseIds.includes(item.caseId) ? "关联影响"
        : run.scopePlan?.prerequisiteCaseIds?.includes(item.caseId) ? "自动前置"
          : run.caseScope.selectedCaseIds.includes(item.caseId) ? "本轮执行，范围未分类" : "本轮未选";
  const pendingPrerequisites = selectedCases.filter(item => {
    const route = planCaseExecution(item).route;
    return item.preconditionsConfirmed !== true && (item.preconditions?.length ?? 0) > 0
      || Boolean(item.coverageGap)
      || ["fixture-or-role", "clarification", "source-review", "manual-analysis"].includes(route);
  });
  const evidenceCount = run.deterministic.results.filter(item => selectedSet.has(item.id)).length
    + run.ai.results.filter(item => selectedSet.has(item.id)).length
    + (run.apiContract?.results.filter(item => selectedSet.has(item.id)).length ?? 0);
  const governance = project.cases.map(item => {
    const plan = planCaseExecution(item);
    const risk = item.sideEffectRisk ?? "unknown";
    const preconditions = item.preconditions?.length ? item.preconditions.join("；") : "无";
    const data = item.testData?.length ? item.testData.join("；") : "未指定";
    const refs = item.requirementRefs?.length ? item.requirementRefs.join("；") : item.source;
    const category = caseCategoryLabels[item.category ?? "functional"];
    const areas = (item.coverageAreas ?? [item.category ?? "functional"]).map(area => caseCategoryLabels[area] ?? area).join("、");
    const lifecycle = item.lifecycleStatus === "draft" ? "草稿" : item.lifecycleStatus === "disabled" ? "停用" : item.lifecycleStatus === "runnable" ? "可运行" : "旧用例未设置";
    const runScope = selectedSet.has(item.id) ? scopeTagFor(item.id) : "[本轮未选] ";
    return `- [状态 ${lifecycle}] ${runScope}${item.id} ${item.title} [${item.priority ?? "P2"}] [${category}；置信度 ${item.confidence ?? "medium"}；覆盖 ${areas}] [执行路径 ${plan.route}] [页面入口 ${item.entryPath ?? "网站版本首页"}]：追溯 ${refs}；前置条件 ${preconditions}${item.preconditions?.length ? `（${item.preconditionsConfirmed ? "已确认" : "未确认"}）` : ""}；测试数据 ${data}；副作用风险 ${risk}；清理 ${item.cleanup || "无/未说明"}；原因 ${plan.reason}；下一步 ${plan.nextAction}`;
  });
  return [
    "# TestPilot 文档驱动测试报告", "", `- 项目：${project.name}`, `- 需求来源：${project.fileName}`, `- 应用：${project.targetUrl}`,
    ...(run.siteVersionSnapshot ? [`- 网站版本：${run.siteVersionSnapshot.label}`, `- 测试环境：${run.siteVersionSnapshot.environment}`, `- 迭代说明：${run.siteVersionSnapshot.changeNotes || "未填写"}`, `- 版本登记时间：${run.siteVersionSnapshot.createdAt}`] : ["- 网站版本：未登记（该项目尚未创建部署版本记录）"]),
    `- 执行模式：${run.runMode === "regression" ? "常规回归（确定性执行，不调用模型）" : "AI 辅助对照（确定性脚本 + Computer Use）"}`,
    `- 用例来源模式：${project.caseMode ?? "both"}`, `- 本轮范围：${run.caseScopeKnown === false ? `历史记录范围未知；记录中找到 ${run.caseScope.selectedCaseIds.length} 条结果` : `选中 ${run.caseScope.selectedCaseIds.length}/${run.caseScope.totalCases} 条用例`}`, ...(run.scopePlan ? [`- 范围类型：${run.scopePlan.mode}`, `- 直接测试目标：${run.scopePlan.targetCaseIds.join("、")}`, `- 关联影响检查：${run.scopePlan.impactCaseIds.join("、") || "无"}`, `- 自动补入前置：${run.scopePlan.prerequisiteCaseIds?.join("、") || "无"}`, `- 实际执行顺序：${run.scopePlan.orderedCaseIds?.join(" → ") || run.caseScope.selectedCaseIds.join(" → ")}`] : []), `- 开始：${run.startedAt}`, `- 完成：${run.completedAt}`,
    ...(run.recovery ? [`- 中断恢复：第 ${run.recovery.resumeCount} 次恢复；已跳过已完成用例 ${run.recovery.skippedCompletedCaseIds.join(", ") || "无"}；中断用例仅在副作用风险为 none 时重试：${run.recovery.interruptedRetryCaseIds.join(", ") || "无"}。未从头无条件重放。`] : []),
    `- 结论：${run.overall}`, `- 所需执行路径已得到结论：${run.finalReady ? "是（仅指本轮适用且对齐的选中用例）" : "否"}`,
    ...(run.baselineRunId ? [
      `- 历史比较基线：${run.baselineRunId}`,
      ...(run.baselineRunSnapshot ? [
        `- 基线网站版本：${run.baselineRunSnapshot.siteVersionSnapshot ? `${run.baselineRunSnapshot.siteVersionSnapshot.environment} · ${run.baselineRunSnapshot.siteVersionSnapshot.label}` : "未登记"}`,
        `- 基线运行时间：${run.baselineRunSnapshot.startedAt} → ${run.baselineRunSnapshot.completedAt}`,
        `- 基线目标网址：${run.baselineRunSnapshot.siteVersionSnapshot?.targetUrl ?? "未登记"}`,
        `- 基线执行方式：${run.baselineRunSnapshot.runMode === "regression" ? "常规回归" : run.baselineRunSnapshot.runMode === "compare" ? "AI 辅助对照" : "历史运行未记录"}`,
        `- 基线范围：${run.baselineRunSnapshot.scopePlan ? `直接目标 ${run.baselineRunSnapshot.scopePlan.targetCaseIds.length} 条 · 关联影响 ${run.baselineRunSnapshot.scopePlan.impactCaseIds.length} 条` : `旧记录范围未分类 · 本轮 ${run.baselineRunSnapshot.selectedCaseCount}/${run.baselineRunSnapshot.totalCases} 条`}`,
        `- 基线用例/脚本版本：${run.baselineRunSnapshot.caseVersion ?? "历史运行未记录"}`,
        `- 基线需求/测试资料版本：${run.baselineRunSnapshot.materialVersion ?? "历史运行未记录"}`,
        `- 基线测试数据版本：${run.baselineRunSnapshot.testDataVersion ?? "历史运行未记录"}`,
      ] : ["- 基线详细版本快照：旧版运行未留存。"]),
      ...(run.baselineEnvironmentComparison === "different" ? [`- 注意：当前与基线的环境标识或目标站点来源不同；结果变化不能单独归因于本次迭代。`] : []),
      ...(run.baselineEnvironmentComparison === "unknown" ? ["- 注意：当前或基线运行缺少有效的环境或目标站点来源记录，无法确认两者一致。"] : []),
      ...(run.baselineRunModeComparison === "different" ? ["- 注意：当前运行方式与基线不同（常规回归与 AI 辅助对照）；通道差异可能影响结果变化判断。"] : []),
      ...(run.baselineRunModeComparison === "unknown" ? ["- 注意：当前运行方式或基线运行方式未记录，无法确认两轮使用相同的验证方法。"] : []),
      ...(run.baselineMaterialChanged ? ["- 注意：本轮需求/测试资料版本与基线不同；逐用例状态可比较，但请先复核新旧需求依据是否仍然等价。"] : []),
      ...(run.baselineRunSnapshot && (!run.materialVersion || !run.baselineRunSnapshot.materialVersion) ? ["- 注意：本轮或基线缺少需求/测试资料版本记录，无法确认资料是否一致。"] : []),
      ...(run.baselineTestDataChanged ? ["- 注意：本轮测试数据版本与基线不同；失败/通过状态变化可能同时受输入数据影响。"] : []),
      ...(run.baselineRunSnapshot && (!run.testDataVersion || !run.baselineRunSnapshot.testDataVersion) ? ["- 注意：本轮或基线缺少测试数据版本记录，无法确认测试数据是否一致。"] : []),
    ] : ["- 历史比较基线：无"]),
    ...(run.stepGeneration ? [`- 运行前补步骤：${run.stepGeneration.generatedCaseIds.length} 条（${run.stepGeneration.requiresReview ? "等待审核" : "自动模式已继续执行"}）`, ...(run.stepGeneration.caseResults?.length ? ["- 逐用例步骤生成结果：", ...run.stepGeneration.caseResults.map(item => `  - [${item.status}] ${item.caseId}（${item.stepCount} 步）：${item.detail}`)] : []), ...(run.stepGeneration.warning ? [`- 补步骤说明：${run.stepGeneration.warning}`] : [])] : []),
    "", "## 资料与调研来源", "", `- 资料版本摘要：${run.materialVersion ?? "历史运行未记录"}`,
    ...(run.sourceMaterialsSnapshot?.length ? run.sourceMaterialsSnapshot.map(item => `- 资料快照：${item.fileName}（${item.role}；${item.byteLength} bytes；SHA-256 ${item.sha256}）`) : (project.sourceFiles ?? [project.fileName]).map(item => `- 本地资料：${item}`)),
    ...(project.caseGeneration ? [`- 独立用例生成 artifact：${project.caseGeneration.artifactId} v${project.caseGeneration.version} · SHA-256 ${project.caseGeneration.digest}`, `- 生成需求基线：${project.caseGeneration.requirements.length} 条；转入项目 ${project.caseGeneration.transferredCases.length} 条 AI 用例` ] : []),
    ...(project.researchExamples ?? []).map(item => `- 公开参考（${item.title}）：${item.url}`),
    ...(project.researchExamples?.length ? [] : ["- 本次没有取得公开搜索结果；用例依据本地资料与目标页面。"]),
    "- 本轮测试数据版本：" + (run.testDataVersion ?? "历史运行未记录"),
    ...(run.parameterValues && Object.keys(run.parameterValues).length ? ["", "## 本轮参数快照", "", "- 测试数据组：" + (project.testDataSets?.find(item => item.id === run.testDataSetId)?.name ?? "本轮手动输入"), "- 参数值：" + JSON.stringify(run.parameterValues), "- 参数仅记录合成测试数据；账号认证使用 Edge 登录态。"] : []),
    "", "## 覆盖领域摘要", "",
    `- 需求/用例已识别领域：${run.coverageSummary?.projectAreas.map(area => caseCategoryLabels[area]).join("、") || "无"}`,
    `- 本轮实际选中领域：${run.coverageSummary?.selectedAreas.map(area => caseCategoryLabels[area]).join("、") || "无"}`,
    `- 已识别但本轮未覆盖领域：${run.coverageSummary?.notCoveredThisRun.map(area => caseCategoryLabels[area]).join("、") || "无"}`,
    "- 领域来自当前已整理用例的分类/覆盖标签；这不是需求完整性证明，也不会推断没有编写用例的需求领域。",
    "", "## 用例清单与本轮范围", "",
    `- 项目库存：${project.cases.length} 条；记录声明总数：${run.caseScope.totalCases} 条。`,
    `- 本轮选中：${selectedIds.length} 条；项目中可对应：${selectedCases.length} 条；记录中无对应项目用例：${selectedIds.filter(id => !project.cases.some(item => item.id === id)).join(", ") || "无"}。`,
    `- 本轮未选：${excluded.length} 条；记录声明排除：${run.caseScope.excludedCaseIds.length} 条。排除 ID：${run.caseScope.excludedCaseIds.join(", ") || "无"}。`,
    `- 选中 ID：${selectedIds.join(", ") || "无"}`,
    `- 全项目覆盖：${selectedIds.length === project.cases.length && excluded.length === 0 && run.caseScope.totalCases === project.cases.length ? "范围数量相符；执行结果仍需看逐用例状态" : "否；本报告只代表选中范围"}`,
    "", "### 未选用例及原因", "", ...(excluded.length ? excluded.map(item => {
      const plan = planCaseExecution(item);
      return `- ${item.id} ${item.title}：未纳入本轮回归（计划路径 ${plan.route}；${plan.reason}；下一步：${plan.nextAction}）。`;
    }) : ["- 无。"]),
    ...(run.scopePlan?.impactCaseIds.length ? ["", "### 关联影响检查依据", "", ...run.scopePlan.impactCaseIds.map(id => `- ${id}：${run.scopePlan?.impactReasons?.[id]?.join("；") || "本次未记录具体关系依据。"}`)] : []),
    "", "## 用例范围与治理", "", ...governance,
    "", "## 前置条件与待解决依赖", "",
    ...(pendingPrerequisites.length ? pendingPrerequisites.map(item => `- ${item.id} ${item.title}：前置条件 ${item.preconditions.join("；") || "未列明"}（${item.preconditionsConfirmed ? "已确认" : "未确认/不适用确认"}）；测试数据 ${item.testData.join("；") || "未指定"}；覆盖缺口 ${item.coverageGap || "无明示缺口"}；当前路径 ${planCaseExecution(item).route}。`) : ["- 本轮选中用例未发现明确的未确认前置条件或已记录 coverageGap；这不证明业务数据和权限已完整验证。"]),
    "", "> 浏览器 runner 只执行标记为只读且前置条件已确认的用例；清理说明不会通过浏览器自动执行。API contract lane 只会执行已审核 suite 中明确配置、获准且指向隔离环境的 fixture setup/cleanup。测试数据字段应写合成数据说明或 fixture 引用，不应存放真实凭证或个人资料。",
    "", "## 执行摘要", "", aiSummary,
    run.runMode === "regression"
      ? `- 用例结论：通过 ${run.comparisons.filter(item => regressionReportOutcome(item) === "通过").length}，失败 ${run.comparisons.filter(item => regressionReportOutcome(item) === "失败").length}，未验证/blocked ${comparisonCounts.unresolved}，N/A ${comparisonCounts.notApplicable}，缺少结果 ${comparisonCounts.missing}。`
      : `- 逐用例比较：对齐 ${comparisonCounts.aligned}，不一致 ${comparisonCounts.mismatch}，未验证/blocked ${comparisonCounts.unresolved}，N/A ${comparisonCounts.notApplicable}，缺少比较记录 ${comparisonCounts.missing}。`,
    `- 执行证据条目：确定性 ${run.deterministic.results.filter(item => selectedSet.has(item.id)).length}、视觉 ${run.runMode === "regression" ? "未运行" : run.ai.results.filter(item => selectedSet.has(item.id)).length}、API ${run.apiContract?.results.filter(item => selectedSet.has(item.id)).length ?? 0}；${run.runMode === "regression" ? "本轮不调用模型。" : `合计 ${evidenceCount}。`} 此处计数代表逐用例结果记录，不表示每条都含截图或完整 trace。`,
    "", "## 重测与恢复记录", "",
    ...(run.parentRunId ? [`- 父运行：${run.parentRunId}`] : ["- 父运行：无（首次运行或未关联重测）"]),
    `- 用例版本摘要：${run.caseVersion ?? "历史运行未记录"}`,
    ...(run.retestSelection ? [`- 本轮重测选择：${run.retestSelection.join(", ") || "无"}`] : ["- 本轮重测选择：非指定子集重测"]),
    ...(run.retestNotes ? [`- 重测说明：${run.retestNotes}`] : []), ...(run.retestScopeNote ? [`- 父运行范围说明：${run.retestScopeNote}`] : []),
    ...recoveryAdoptionReportLines(run),
    ...(run.recovery ? [`- 运行恢复：恢复 ${run.recovery.resumeCount} 次；跳过已完成用例 ${run.recovery.skippedCompletedCaseIds.length} 条；安全重试中断用例 ${run.recovery.interruptedRetryCaseIds.length} 条。`] : ["- 本运行记录没有中断恢复信息。"]),
    "- 结果对齐分类与根因初步分类分别记录；根因提示仅依据本轮留存证据，仍需人工复核。证据不足的项目会标为待确认。",
    ...(run.diagnostics?.length ? ["", "### 诊断证据", "", ...run.diagnostics.filter(item => item.classification === "mismatch" || item.classification === "unverified").map(item => `- ${item.caseId} [${item.classification}]：脚本=${item.deterministicEvidence}；Computer Use=${item.computerUseEvidence}${item.apiEvidence ? `；API=${item.apiEvidence}` : ""}`)] : []),
    "", "## 差异分析与后续建议", "", run.analysis ?? "无",
    ...(run.runMode === "compare" ? ["", "> AI 辅助对照模式使用配置的 Computer Use 能力。它与确定性脚本按顺序复用本轮浏览器页面和登录态，不是隔离会话中的独立复现；执行器会拦截已识别的提交、保存、删除、支付、确认等高风险操作。"] : []),
    "", ...lane("确定性用例", run.deterministic, selectedIds), ...(run.apiContract ? ["## API Contract 验证", "", run.apiContract.summary, ...(run.apiContract.scope?.length ? ["", "执行范围：", ...run.apiContract.scope.map(item => `- ${item}`)] : []), ...(run.apiContract.limitations?.length ? ["", "授权与限制：", ...run.apiContract.limitations.map(item => `- ${item}`)] : []), "", ...run.apiContract.results.filter(item => selectedSet.has(item.id)).map(item => `- ${scopeTagFor(item.id)}[${item.status}] ${item.title} (${item.id}) — ${item.detail}`), ""] : []), ...(run.runMode === "compare" ? lane("视觉 Computer Use 验证", run.ai, selectedIds) : []),
    ...(run.runMode === "compare" && run.ai.diagnostics?.length ? ["", "### Computer Use 全局诊断", "", ...run.ai.diagnostics.map(item => `- ${item}`)] : []), "",
    ...(run.runMode === "compare" ? run.ai.results.filter(item => selectedSet.has(item.id)).map(item => `- ${scopeTagFor(item.id)}[${item.status}] ${item.title} (${item.id}) — ${item.detail}`) : []), "", run.runMode === "regression" ? "## 逐用例回归结果" : "## 逐用例对比", "",
    ...run.comparisons.map(item => `- ${scopeTagFor(item.id)}[${item.deterministic === "cancelled" || item.apiContract === "cancelled" ? "已取消" : item.deterministic === "not-run" || item.apiContract === "not-run" ? "未运行" : run.runMode === "regression" ? regressionReportOutcome(item) : item.resolution === "mismatch" ? "结果不一致" : item.resolution === "unresolved" ? "未验证" : item.resolution === "not-applicable" ? "N/A" : item.aligned ? "结论一致" : "待处理"}] ${item.title} (${item.id}) — 脚本 ${item.deterministic}${run.runMode === "compare" ? ` / Computer Use ${item.computerUse}` : ""}${item.apiContract ? ` / API Contract ${item.apiContract}` : ""}${item.issue ? `：${item.issue}` : ""}${item.triage ? `；初步归类 ${triageCategoryLabels[item.triage.category]}（${item.triage.confidence === "evidence-based" ? "有直接证据" : "需复核"}）：${item.triage.detail}` : ""}${item.nextAction ? `；下一步：${item.nextAction}` : ""}`),
    ...(run.baselineComparison ? ["", "## 历史基线对比", "", `- 基线运行：${run.baselineRunId}`,
      ...(run.baselineEnvironmentComparison === "different" ? ["- 当前与基线的环境标识或目标站点来源不同；请先确认环境差异不会解释本轮状态变化。"] : []),
      ...(run.baselineEnvironmentComparison === "unknown" ? ["- 当前运行或基线缺少有效的环境或目标站点来源记录，无法确认环境一致。"] : []),
      ...(run.baselineRunModeComparison === "different" ? ["- 当前运行与基线使用了不同的验证方式；通道差异可能影响结果变化判断。"] : []),
      ...(run.baselineRunModeComparison === "unknown" ? ["- 当前运行或基线未记录验证方式，无法确认两轮方法一致。"] : []),
      `- 疑似回归 ${baselineDispositionCounts.regression ?? 0}；已修复 ${baselineDispositionCounts.fixed ?? 0}；未变化 ${baselineDispositionCounts.unchanged ?? 0}；用例已修改 ${baselineDispositionCounts["case-changed"] ?? 0}；新增 ${baselineDispositionCounts.added ?? 0}；移除 ${baselineDispositionCounts.removed ?? 0}；未运行 ${baselineDispositionCounts["not-run"] ?? 0}；无法比较 ${baselineDispositionCounts.unresolved ?? 0}；基线无结果 ${baselineDispositionCounts["no-baseline-result"] ?? 0}。`,
      ...run.baselineComparison.map(item => `- [基线 ${baselineRunScopeLabel(item.caseId)} → 本轮 ${currentRunScopeLabel(item)} · ${baselineDispositionLabels[item.disposition]}] ${item.caseId} ${item.title}：基线 ${baselineStatusLabel(item.baselineStatus)} → 本次 ${baselineStatusLabel(item.currentStatus)}${item.caseChanged ? "；用例或脚本内容已变化，不能直接归为产品回归" : ""}`),
    ] : []),
    ...(run.runMode === "compare" ? ["", "> 两侧结果相同是对本批用例的对齐证据，不证明应用没有其他缺陷或测试覆盖完整。"] : []),
  ].join("\n");
}

