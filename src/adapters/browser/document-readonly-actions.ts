import type { Page } from 'playwright';
/** Self-contained so the same implementation can be embedded in exported runners. */
export async function executeReadonlyNavigationCheck(page: Page, step: {action:'goBack'} | {action:'assertControlEnabled';text:string}):Promise<void> {
 if(step.action==='goBack') {
  const origin=new URL(page.url()).origin;
  await page.goBack({waitUntil:'domcontentloaded',timeout:15000});
  if(new URL(page.url()).origin!==origin)throw new Error('Blocked: 返回后页面不在当前目标来源。');
  return;
 }
 const control=page.getByText(step.text,{exact:true}).filter({visible:true});
 if(await control.count()!==1)throw new Error('Blocked: 可用状态控件必须唯一可见：'+step.text);
 const enabled=await control.evaluate(element=>{
  let node:Element|null=element;
  for(let depth=0;node && depth<5;depth++,node=node.parentElement) {
   if(!node.matches('button,input,[role=button],[class*=button],[class*=btn]'))continue;
   return !node.hasAttribute('disabled') && node.getAttribute('aria-disabled')!=='true' && !/disabled/i.test(node.className) && getComputedStyle(node).pointerEvents!=='none';
  }
  return false;
 });
 if(!enabled)throw new Error('断言失败：控件没有处于可用状态：'+step.text);
}
