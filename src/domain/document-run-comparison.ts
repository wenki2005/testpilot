import type { BrowserCheck, CaseComparison, CaseResult, DocumentRunMode, LaneResult } from "./document-test-model.js";
import { planCaseExecution } from "./document-case-routing.js";
import { classifyComparison } from "./document-result-classification.js";

export function partialUiFindingNote(results: Array<Pick<CaseResult, "status" | "detail">>): string | undefined {
  const finding = results.find(result => result.status !== "passed"
    && /(?:违反.{0,8}(?:预期|期望)|与预期.{0,24}不符|does not (?:meet|match) (?:the )?expectation|(?:the )?front[- ]?end.{0,80}(?:does not allow|rejects|clamps|truncates).{0,80}(?:1000|9999|legal values)|前端.{0,12}(?:拒绝|不允许|未允许)|(?:已复现|复现).{0,12}(?:缺陷|错误|上限)|失焦后.{0,24}(?:改为|变为|被改为|显示为).{0,8}[「“]?999|after\s+(?:clicking away|tab\s+)?(?:blur|losing focus).{0,100}(?:changed|became|displayed|reset|reverted|returned).{0,40}999|观察窗口内出现\s*\d+\s*个\s*fetch\/XHR\s*请求|(?:observed|captured)\s+\d+\s+fetch\/?XHR\s+requests?)/iu.test(result.detail));
  if (!finding) return undefined;
  const excerpt = finding.detail.replace(/\s+/gu, " ").slice(0, 360);
  return `部分 UI 检查发现疑似产品缺陷（仍待完整验证）：${excerpt}`;
}

export function buildDocumentRunComparisons(input: {
  cases: BrowserCheck[];
  deterministic: LaneResult;
  computerUse: LaneResult;
  apiContract?: { results: Array<{ id: string; status: CaseResult["status"]; detail: string }> };
  runMode: DocumentRunMode;
  aborted: boolean;
}): CaseComparison[] {
  const deterministicById = new Map(input.deterministic.results.map(item => [item.id, item]));
  const computerUseById = new Map(input.computerUse.results.map(item => [item.id, item]));
  const apiById = new Map((input.apiContract?.results ?? []).map(item => [item.id, item]));
  return input.cases.map(item => {
    const script = deterministicById.get(item.id);
    const visualCase = computerUseById.get(item.id);
    const left = script?.status ?? (input.aborted ? "not-run" : "blocked");
    const right = visualCase?.status ?? (input.aborted ? "not-run" : "blocked");
    const apiCase = apiById.get(item.id);
    const executionPlan = planCaseExecution(item);
    const isApiRoute = executionPlan.route === "api-contract";
    const partialFinding = partialUiFindingNote([script, visualCase].filter((result): result is CaseResult => Boolean(result)));
    const apiHasUiSubcheck = isApiRoute && item.steps.length > 0;
    const regressionTerminal = (status: CaseResult["status"]) => status === "passed" || status === "failed" || status === "not-applicable";
    const resolution = input.runMode === "regression"
      ? isApiRoute
        ? apiCase && regressionTerminal(apiCase.status) && (!apiHasUiSubcheck || regressionTerminal(left)) ? "aligned" : "unresolved"
        : left === "not-applicable" ? "not-applicable" : regressionTerminal(left) ? "aligned" : "unresolved"
      : isApiRoute
        ? apiCase?.status === "passed" && (!apiHasUiSubcheck || (left === "passed" && right === "passed")) ? "aligned" : "unresolved"
        : classifyComparison(left, right);
    const regressionFailed = input.runMode === "regression" && (script?.status === "failed" || apiCase?.status === "failed");
    const issue = input.aborted && (left === "cancelled" || left === "not-run" || right === "cancelled" || right === "not-run" || apiCase?.status === "cancelled" || apiCase?.status === "not-run")
      ? "运行被手动停止；已完成结果保留，取消或尚未运行的用例可在本轮结果中定向重跑。"
      : resolution === "aligned" && !regressionFailed ? ""
        : input.runMode === "regression" && regressionFailed
          ? `常规回归已执行并发现失败：脚本 ${left}${apiCase ? ` / API ${apiCase.status}` : ""}。请检查逐步证据并确认是否为产品回归、测试数据或环境问题。`
          : resolution === "not-applicable" ? "需求来源标记为本期范围外；保留追溯，不计入通过。"
            : isApiRoute ? `${apiCase?.detail ?? "API contract lane 未产生结果。"}${apiHasUiSubcheck && (left !== "passed" || right !== "passed") ? `；另有浏览器子检查未双通道通过（脚本 ${left} / Computer Use ${right}）。` : ""}${partialFinding ? `；${partialFinding}` : ""} 下一步：${executionPlan.nextAction}`
              : left === "blocked" && right === "blocked" ? `两侧都未得到可判定结果；这是未验证项，不是两侧结果不一致。${executionPlan.reason}${partialFinding ? `；${partialFinding}` : ""} 下一步：${executionPlan.nextAction}`
                : left === "blocked" || right === "blocked" ? `只有一侧得到完整执行结果；当前无法进行双通道比较。${partialFinding ? `；${partialFinding}` : ""}`
                  : `结果不一致：确定性脚本 ${left}，Computer Use ${right}。`;
    const nextAction = (resolution === "aligned" && !regressionFailed) || resolution === "not-applicable" ? undefined : executionPlan.nextAction;
    return { id: item.id, title: item.title, deterministic: left, computerUse: right, ...(apiCase ? { apiContract: apiCase.status } : {}), aligned: resolution === "aligned", resolution, issue, ...(nextAction ? { nextAction } : {}) };
  });
}
