import type { BaselineDisposition, CaseComparison, ComparisonResolution, DocumentCaseTriage } from "./document-test-model.js";

export function classifyDocumentCaseTriage(input: {
  status: CaseComparison["deterministic"];
  detail: string;
  baselineDisposition?: BaselineDisposition;
  caseChanged?: boolean;
  materialChanged?: boolean;
  testDataChanged?: boolean;
  baselineEnvironmentComparison?: "same" | "different" | "unknown";
  baselineRunModeComparison?: "same" | "different" | "unknown";
  regressionMode?: boolean;
}): DocumentCaseTriage | undefined {
  if (["passed", "not-applicable", "cancelled", "not-run"].includes(input.status)) return undefined;
  const detail = input.detail.replace(/\s+/gu, " ").slice(0, 700);
  if (/(?:fixture|夹具|setup|cleanup).{0,80}(?:fail|failed|阻塞|未通过|失败)|(?:fail|failed|阻塞|未通过|失败).{0,80}(?:fixture|夹具|setup|cleanup)|缺少(?:可复用)?测试数据|前置条件尚未/u.test(detail)) {
    return { category: "test-data-or-fixture", confidence: "evidence-based", detail: "测试数据、前置条件或 fixture setup/cleanup 未就绪；先恢复数据状态，再判断产品行为。" };
  }
  if (/(?:登录|扫码|会话|浏览器未能开始|无法建立用例页面基线|net::ERR_|ECONNRESET|ECONNREFUSED|连接被拒绝|页面重载后出现登录|微信客户端|企业微信客户端|WeChat(?: Work)? client gate)/iu.test(detail)) {
    return { category: "environment-or-session", confidence: "evidence-based", detail: "运行证据指向登录会话、微信客户端访问门禁、浏览器启动或网络连接问题；先恢复目标环境，再判断产品行为。" };
  }
  if (/(?:定位|标签未匹配|字段不可见|占位符.{0,20}(?:匹配|唯一|消失)|strict mode violation|resolved to 0 elements|ambiguous|multiple elements|元素.{0,20}(?:未找到|不唯一))/iu.test(detail)) {
    return { category: "locator-failure", confidence: "evidence-based", detail: "执行证据显示元素定位失效或不唯一；先检查当前页面控件和用例定位。" };
  }
  if (input.testDataChanged) return { category: "test-data-or-fixture", confidence: "evidence-based", detail: "本轮测试数据版本与基线不同；先确认输入和数据状态等价，再判断产品回归。" };
  if (input.caseChanged || input.baselineDisposition === "case-changed" || input.materialChanged) {
    return { category: "case-or-expectation-review", confidence: "evidence-based", detail: "用例步骤、预期或需求资料相对基线已变化；先复核验收依据，再判断产品回归。" };
  }
  if ((input.baselineEnvironmentComparison && input.baselineEnvironmentComparison !== "same")
    || (input.baselineRunModeComparison && input.baselineRunModeComparison !== "same")) {
    return { category: "needs-review", confidence: "evidence-based", detail: "本轮与基线的测试环境或验证方式不同、或记录不全；状态变化可见，但目前不能可靠归因于产品回归。" };
  }
  if (input.status === "failed" && input.regressionMode === true && input.baselineDisposition === "regression") {
    return { category: "suspected-product-regression", confidence: "tentative", detail: "相同用例在基线通过、本轮失败；这是疑似产品回归证据，仍需核对环境和业务数据。" };
  }
  if (input.status === "failed" && /断言失败|期望.{0,30}(?:未出现|不符|不可见)|字段值与预期不符|不应出现的文本仍可见/iu.test(detail)) {
    return { category: "case-or-expectation-review", confidence: "tentative", detail: "断言与当前页面行为不符；可能是产品行为变化，也可能是预期或页面文本已过期，需人工复核。" };
  }
  return { category: "needs-review", confidence: "tentative", detail: "现有证据不足以可靠区分产品、用例、数据或环境问题；保留待确认。" };
}

/** Keep true outcome disagreement separate from cases that both lanes could not verify. */
export function classifyComparison(left: CaseComparison["deterministic"], right: CaseComparison["deterministic"]): ComparisonResolution {
  if (left === "not-applicable" && right === "not-applicable") return "not-applicable";
  if ((left === "passed" || left === "failed") && left === right) return "aligned";
  if (["blocked", "cancelled", "not-run"].includes(left) || ["blocked", "cancelled", "not-run"].includes(right)) return "unresolved";
  return "mismatch";
}
