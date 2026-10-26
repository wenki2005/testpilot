/**
 * Classifies visual-lane evidence conservatively. A missing expected item is
 * not proof of a product defect when the page has no matching data to render.
 * Callers may mark a result failed only when they have affirmative evidence
 * of a contradictory product state (for example, a populated target record
 * showing the wrong status).
 */
export type ComputerUseEvidenceInput = {
  recordedStatus: "passed" | "failed" | "inconclusive";
  recordedEvidence: string;
  assertionFailures?: string[];
  unverifiedAssertions?: string[];
  coverageGap?: string;
  /** Set only when an observed target control/record directly contradicts the expected result. */
  positiveContradiction?: boolean;
};

export type ComputerUseEvidenceClassification = {
  status: "passed" | "failed" | "blocked";
  detail: string;
};

const missingEvidencePattern = /(?:文本未出现|精确文本未出现|精确控件未出现|找不到禁用状态控件|无法定位字段|字段只有\s*\d+\s*个匹配|未观察到|没有相应记录|没有对应记录|列表为空|暂无.{0,16}(?:记录|数据|订单|申请)|无.{0,12}(?:fixture|夹具|测试数据)|fixture.{0,12}(?:缺失|不存在)|无法观察|无法判定|not observable|no (?:matching )?records?|empty (?:list|results?))/iu;
const positiveMismatchPattern = /(?:字段值不匹配|不应出现的文本仍可见|控件未禁用|字段未呈现无效\/红色状态|(?:输入|录入|键入).{0,40}(?:1000|9999).{0,140}(?:失焦后|失焦|离开字段|离开输入框|blur).{0,100}(?:改为|变为|被改为|被自动改写为|自动改写为|改写为|显示为|截断|夹取|clamp(?:ed)?).{0,12}[「“]?999(?:\D|$)|(?:enter(?:ing)?\s+(?:1000|9999)|typ(?:e|ed|ing)\s+(?:1000|9999)).{0,180}(?:after\s+(?:clicking away|tab\s+)?(?:blur|losing focus)|after\s+blur|blur).{0,100}(?:changed|became|displayed|clamped|truncated|reset|reverted|returned)\s+(?:(?:back|to)\s+)?["“]?999(?:\D|$)|(?:enter(?:ing)?\s+(?:1000|9999)|typ(?:e|ed|ing)\s+(?:1000|9999)).{0,200}(?:after\s+(?:clicking away|tab|blur|losing focus)|on\s+blur|blur).{0,100}(?:(?:the\s+)?(?:field|value)\s+)?(?:visibly\s+)?(?:changed|became|displayed|clamped|truncated|reset|reverted|returned)\s+(?:(?:back|to)\s+)?["“]?999(?:\D|$)|(?:front[- ]?end|frontend).{0,120}(?:does not allow|rejects|clamps|truncates).{0,80}(?:1000|9999|legal values)|(?:非数字|non[- ]numeric).{0,200}(?:请求|查询|request|lookup|loading).{0,120}(?:触发|发出|发送|triggered|sent|appeared).{0,200}(?:未|没有|无|no|not).{0,30}(?:拦截|校验|验证|阻止|intercept|validation|blocked)|(?:not intercepted|bypassed validation).{0,120}(?:request|lookup)|页面(?:仍是|仍为|保持).{0,32}(?:桌面|未适配)|(?:内容|页面|标题|控件).{0,24}(?:被|遭到?)(?:右边缘)?(?:裁切|截断)|(?:横向溢出|horizontal overflow|cut off at the right edge|content is clipped)|(?:仍为|恢复为).{0,16}(?:默认)?灰色边框|未(?:出现|观察到|显示).{0,32}(?:持续的)?(?:校验拦截|拦截提示|无效状态|红色边框))/iu;
const explicitUncertaintyPattern = /(?:无法(?:安全)?(?:验证|判定|核对|观察|查看|进入|建立|触发)|未能(?:验证|判定|核对|观察|查看)|缺少.{0,32}(?:fixture|夹具|测试数据|测试账号|业务记录|订单样例|申请记录)|(?:cannot|unable to|could not|not able to)\s+(?:verify|determine|observe|access|trigger)|(?:no|missing)\s+(?:matching\s+)?(?:fixture|test data|test account|records?|orders?|applications?|notification|message|approval|detail view)|requires?\s+(?:a\s+)?(?:test|supervisor|role|fixture|account))/iu;
const explicitVisualConfirmationPattern = /(?:截图(?:可见|显示|确认|中).{0,120}(?:完整|准确|精确|显示|呈现|保留)|(?:输入框|字段).{0,60}(?:完整呈现|准确显示|精确显示|完整显示|保留完整|仅显示)|(?:screenshot|screen).{0,80}(?:shows?|displays?|confirms?).{0,140}(?:visible|complete|exact|retained|accepted|accepts|value|text)|field.{0,80}(?:shows?|retains?|displays?|accepts?).{0,100}(?:value|characters?|text))/iu;

export function classifyComputerUseEvidence(input: ComputerUseEvidenceInput): ComputerUseEvidenceClassification {
  const failures = input.assertionFailures ?? [];
  const missingOnly = failures.length > 0 && failures.every(failure => missingEvidencePattern.test(failure));
  const evidenceText = `${input.recordedEvidence}\n${input.coverageGap ?? ""}`;
  const positiveFailure = failures.some(failure => positiveMismatchPattern.test(failure)) || positiveMismatchPattern.test(evidenceText);
  // An empty state can itself be the expected, directly observable outcome
  // (for example, “no orders: show the empty state”). Treat it as a missing
  // fixture only when the evidence explicitly says the required fixture is
  // unavailable, not merely because the page says “暂无订单”.
  const fixtureUnavailable = /(?:没有相应记录|没有对应记录|预置.{0,12}(?:缺失|不存在)|无.{0,12}(?:fixture|夹具|测试数据)|fixture.{0,12}(?:缺失|不存在)|无法观察|无法判定|not observable|no (?:matching )?records?|empty (?:list|results?))/iu.test(evidenceText);

  // The agent can correctly describe an unobservable case while its
  // deterministic assertion still reports “text missing” on the empty page.
  // Preserve that as unresolved unless affirmative contradictory evidence was
  // supplied; otherwise a missing role/fixture is mislabeled as a product bug.
  if (!input.positiveContradiction && explicitUncertaintyPattern.test(evidenceText)) {
    return { status: "blocked", detail: `${input.recordedEvidence}；目标记录/状态数据不可用或当前证据无法判定，缺少可判定产品行为的证据，结果记为 blocked/inconclusive。` };
  }
  if (!input.positiveContradiction && input.recordedStatus === "inconclusive" && !positiveFailure) {
    return { status: "blocked", detail: `${input.recordedEvidence}；目标记录/状态数据不可用或当前证据无法判定，缺少可判定产品行为的证据，结果记为 blocked/inconclusive。` };
  }

  // An explicitly empty/missing fixture makes an absent record assertion
  // inconclusive. A missing expected UI element by itself is different: it is
  // affirmative evidence that the visible acceptance point was not met.
  if (!input.positiveContradiction && !positiveFailure && fixtureUnavailable) {
    const reason = "目标记录/状态数据不可用，缺少可判定产品行为的证据";
    return { status: "blocked", detail: `${input.recordedEvidence}；${reason}，结果记为 blocked/inconclusive。` };
  }

  if (input.positiveContradiction || positiveFailure || (missingOnly && failures.length > 0)) {
    return { status: "failed", detail: input.recordedEvidence };
  }
  if (input.recordedStatus !== "passed") return { status: "blocked", detail: `${input.recordedEvidence}；视觉通道没有足够证据完成判定，结果记为 blocked/inconclusive。` };
  const visualOnlyRemainder = (input.unverifiedAssertions?.length ?? 0) > 0
    && !input.coverageGap
    && input.unverifiedAssertions!.every(assertion => /无法通过 DOM 定位器复核字段(?:值|无效状态)/u.test(assertion))
    && explicitVisualConfirmationPattern.test(input.recordedEvidence);
  if (failures.length > 0 || ((input.unverifiedAssertions?.length ?? 0) > 0 && !visualOnlyRemainder) || input.coverageGap) {
    return { status: "blocked", detail: input.recordedEvidence };
  }
  return { status: "passed", detail: input.recordedEvidence };
}
