import type {BrowserCheck} from './document-test-model.js';
/** Explicit acceptance literals must be asserted, never merely typed/clicked. */
export function missingRequiredAssertions(item: Pick<BrowserCheck,'steps'|'requiredAssertions'>):string|undefined {
 const values=(item.steps ?? []).filter(step=>['assertText','assertVisible','assertExactVisible','assertValue','assertValueByPlaceholder','assertRoleVisible','assertControlEnabled'].includes(step.action)).flatMap(step=>'text' in step?[step.text]:'value' in step && typeof step.value==='string'?[step.value]:'name' in step?[step.name]:[]);
 const missing=(item.requiredAssertions ?? []).filter(value=>!values.some(assertion=>assertion.includes(value)));
 return missing.length?`缺少明确验收值的结果断言：${missing.join('、')}；输入或标题检查不能替代结果核对。`:undefined;
}
