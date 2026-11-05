import type { BrowserCheck } from "../shared/test-model.js";
import { missingRequiredAssertions } from './required-assertions.js';
/** Detect known false-pass patterns where a generic visible control does
 * not prove the actual requirement stated in the source case. */
export function missingDirectAssertion(check: BrowserCheck): string | undefined {
    const missing = missingRequiredAssertions(check);
    if (missing)
        return missing;
    const expectation = `${check.title} ${check.expected}`;
    const steps = check.steps ?? [];
    if (/多行样书明细.*(?:小计|总计)/u.test(expectation)) {
        const numericAssertions = steps.filter(step => ['assertText', 'assertVisible', 'assertExactVisible'].includes(step.action) && 'text' in step && /\d/u.test(step.text));
        if (numericAssertions.length < 4)
            return '多行金额与重量验收需要对实际记录的逐行小计、总金额、总重量及图书/数量给出直接数值断言；只检查表头或零值不能证明多行计算。请利用本次数据库明细和当前页面证据。';
    }
    if (/页面纯只读.*(?:编辑|提交|删除)/u.test(expectation) && !['编辑', '提交', '删除'].every(text => steps.some(step => step.action === 'assertNotVisible' && step.text.includes(text)))) {
        return '只读页面验收需要明确检查编辑、提交和删除入口均不存在，不能只检查页面标题。';
    }
    if (/全部必填完成.*跳转.*创建待审核记录/u.test(expectation) && !check.authorizedWriteOperationId)
        return '完整提交验收需要与本轮创建记录关联的单次提交证据；静态字段和按钮可点击不能证明跳转及创建记录。';
    if (/合法数量.*(?:9999|9,999)|数量.*1.{0,5}9999/u.test(expectation) && steps.some(step => step.action === 'fillByLabel' || step.action === 'fillByPlaceholder') && !steps.some(step => step.action === 'blurByLabel' || step.action === 'blurByPlaceholder'))
        return '合法数量范围需要在输入后触发失焦/变更，再核对保留值；输入后立即断言会漏掉实际数量格式化。';
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
    if (/(?:下拉无结果|无匹配客户)/u.test(expectation)) {
        const searched = steps.some(step => ['fillByRoleIndex', 'fillByLabel', 'fillByPlaceholder'].includes(step.action));
        const emptyResult = steps.some(step => ['assertText', 'assertVisible', 'assertExactVisible'].includes(step.action) && 'text' in step && /无匹配|无结果|暂无数据|无数据|没有匹配|no (?:data|results|matching)/iu.test(step.text));
        if (!searched || !emptyResult)
            return '预期要求实际搜索后的空结果提示；客户字段标题、金额和其他页面文字不能证明没有匹配结果。需要可观察的空结果断言。';
    }
    if (/逐级选择.{0,12}回填/u.test(expectation)) {
        const selections = steps.filter(step => ['selectByRoleIndex', 'selectByLabel', 'selectByPlaceholder'].includes(step.action));
        const selectedValues = selections.flatMap(step => 'value' in step ? [step.value] : []);
        const assertions = steps.filter(step => ['assertValue', 'assertValueByPlaceholder', 'assertSelectedByRoleIndex'].includes(step.action));
        if (selections.length < 3 || selectedValues.some(value => !assertions.some(step => 'value' in step && step.value === value)))
            return '预期要求省、市、区三级实际选择并逐项核对回填值；只检查所在地区或请选择文案不能证明选择成功。';
    }
    return undefined;
}
