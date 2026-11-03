/** Test-environment baseline identified by Chinese business names and fixed
 * for xmind-128 at the user's request on 2026-11-03. This is not an OA creation
 * or approval-callback test; those belong to xmind-119. */
export const departmentOaTemplateBaseline = [
  {usage:1,name:'部门样书申请-营销用书',templateId:'C4enk3QyyZi7NYJXM8ShAUZ6jwTKUMdPzEWAUceGH'},
  {usage:2,name:'部门样书申请-产品用书',templateId:'C4enk3UYnvWjJmLGxb4PHgGhX5h4hqgju2yoEu89z'},
] as const;
export type OaTemplateConfigurationSnapshot={
  templates:Array<{name:string;templateId:string;deleted:boolean}>;
  applications:Array<{usage:number;templateId:string|null;count:number}>;
};
export function verifyDepartmentOaTemplateConfiguration(snapshot:OaTemplateConfigurationSnapshot):{status:'passed'|'failed'|'blocked';detail:string}{
 const active=snapshot.templates.filter(t=>!t.deleted);
 for(const b of departmentOaTemplateBaseline){
  const named=active.filter(t=>t.name===b.name),byId=active.filter(t=>t.templateId===b.templateId);
  if(named.length!==1||byId.length!==1||named[0]!.templateId!==b.templateId||byId[0]!.name!==b.name)
   return{status:'failed',detail:`断言失败：${b.name}未唯一对应已确认测试库基线中的有效企微模板ID；检查缺失、重复、停用或名称/ID错配。`};
 }
 if(snapshot.applications.some(a=>!Number.isSafeInteger(a.count)||a.count<1||!departmentOaTemplateBaseline.some(b=>b.usage===a.usage)))
  return{status:'blocked',detail:'模板定义已核对，但申请聚合含未约定用途或无效计数，未猜测新用途的模板规则。'};
 const missing:number[]=[];const counts:number[]=[];
 for(const b of departmentOaTemplateBaseline){
  const rows=snapshot.applications.filter(a=>a.usage===b.usage),count=rows.reduce((n,a)=>n+a.count,0);counts.push(count);
  if(rows.some(a=>a.templateId!==b.templateId))return{status:'failed',detail:`断言失败：${b.name}的实际申请存在空模板ID或引用其他模板；模板存在不能掩盖用途映射错误。`};
  if(!count)missing.push(b.usage);
 }
 if(missing.length)return{status:'blocked',detail:'两条有效模板的名称和企微ID均匹配已确认基线；用途'+missing.join('、')+'没有实际申请，尚不能完成两类用途引用核验。'};
 return{status:'passed',detail:`已只读重查biz_wechat_oa_template：营销用书、产品用书的中文名称与已确认企微模板ID各唯一匹配且未删除；按biz_dept_book_apply.book_usage核对全部有效申请，营销${counts[0]}条、产品${counts[1]}条均引用各自正确模板，无空值或交叉引用。xmind-128当前测试库模板配置及实际用途映射通过；未将此结果扩展为xmind-119真实创建审批单、进度/结果/驳回理由回传通过。`};
}
