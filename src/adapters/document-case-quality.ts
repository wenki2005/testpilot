import type { BrowserCheck } from "./document-test-workflow.js";

/** Detect two known false-pass patterns where a generic visible control does
 * not prove the actual requirement stated in the source case. */
export function missingDirectAssertion(check: BrowserCheck): string | undefined {
  const expectation = `${check.title} ${check.expected}`;
  const steps = check.steps ?? [];
  if (/(?:標紅|标红|紅框|红框|邊框變紅|边框变红|紅色邊框|红色边框)/u.test(expectation)
    && !steps.some(step => step.action === "assertFieldInvalid")) {
    return "預期要求字段进入红色/无效状态，但步骤没有检查字段自身的无效状态；检查按钮禁用或字段标题不能证明字段标红。";
  }
  if (/(?:響應式|响应式|PC與H5|PC与H5|移動端適配|移动端适配)/u.test(expectation)
    && !(steps.some(step => step.action === "setViewport") && steps.some(step => step.action === "assertNoHorizontalOverflow"))) {
    return "预期要求响应式适配，但步骤没有同时切换实际 viewport 并检查横向溢出；标题可见不代表移动端布局可用。";
  }
  if (/(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(expectation)
    && !(steps.some(step => step.action === "startFetchOrXhrCapture") && steps.some(step => step.action === "assertNoFetchOrXhr"))) {
    return "预期包含“不调用接口/不发请求”，但步骤没有在用户操作前启动 fetch/XHR 捕获并在操作后断言无请求；DOM 或截图无法证明网络行为。";
  }
  return undefined;
}
