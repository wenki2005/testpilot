import type { WebsiteMapPage } from './website-map.js';

type PageScope = 'order-list'|'order-detail'|'application-list'|'application-form'|'application-detail'|'application-approval';
/** Module declarations constrain model choices. An application is not an order. */
export function caseNavigationScope(item:{source:string;title?:string;expected?:string;modulePath?:string[]}):PageScope|undefined {
  const segments=item.source.split('›');
  const moduleText=[...(item.modulePath??[]),segments.length>1?segments[1]!:item.source].join(' ');
  if(/订单|orders?/iu.test(moduleText)&&/订单.{0,5}详情|order\s+details?/iu.test(`${item.title??''} ${item.expected??''}`))return 'order-detail';
  if(/订单.{0,5}详情|order\s+details?/iu.test(moduleText))return 'order-detail';
  if(/订单.{0,5}列表|order\s+list/iu.test(moduleText))return 'order-list';
  if(/审批详情|approval\s+details?/iu.test(moduleText))return 'application-approval';
  if(/申请表单明细|申请明细|表单明细展示/iu.test(moduleText))return 'application-detail';
  if(/历史申请记录|我的申请|application\s+(?:history|list)/iu.test(moduleText))return 'application-list';
  if(/样书申请表单|application\s+form/iu.test(moduleText))return 'application-form';
  return undefined;
}
export function observedNavigationScope(page:WebsiteMapPage):PageScope|undefined {
  const headings=page.snapshot.headings.join(' '),last=page.path.at(-1)?.label??'';
  if(/订单.{0,5}详情|order\s+details?/iu.test(headings+' '+last))return 'order-detail';
  if(/订单物流|订单列表|我的订单|orders?(?:\s+list)?/iu.test(headings))return 'order-list';
  if(/审批详情|approval\s+details?/iu.test(headings))return 'application-approval';
  if(/申请明细|表单明细|application\s+details?/iu.test(last+' '+headings))return 'application-detail';
  if(/历史申请记录|我的申请|application\s+(?:history|list)/iu.test(headings))return 'application-list';
  if(/样书申请|application\s+form/iu.test(headings))return 'application-form';
  return undefined;
}
export function isCaseNavigationPageInScope(item:{source:string;title?:string;expected?:string;modulePath?:string[]},page:WebsiteMapPage):boolean {
  const required=caseNavigationScope(item);
  return !required||observedNavigationScope(page)===required;
}
