/** A negative requirement is executable even when an ancestor says the
 * feature is not implemented this release. Comments remain annotations. */
export function excludedCaseReason(item:{title:string;expected:string;source:string}):string|undefined{
 const leaf=`${item.title} ${item.expected}`;
 if(/^\/\/\s*前置[：:]/u.test(item.expected)&&/本期不做/u.test(item.source))return '原条目是后续功能分支的前置说明，没有独立的本期验收动作；保留追踪，不计为通过。';
 if(/不展示|不可选|不提供|不触发|不回传|不显示|不可见|去除|下线|返回无权限/u.test(leaf))return;
 if(/本期不做|待后续需求|明确不纳入|范围外/u.test(leaf+' '+item.source))return '原来源明确标注本期范围外；保留原文及编号，不计为通过。';
}
