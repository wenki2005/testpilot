import type {Page,Locator} from 'playwright';
import type {BrowserCheck} from './document-test-workflow.js';

export const isSampleRowDelete=(check:Pick<BrowserCheck,'expected'|'source'>)=>check.expected==='每行提供删除按钮，可删除误加的样书行（H5设计稿已确认新增）'&&check.source.includes('向下复制空白图书明细行');
const snapshot=(rows:Locator)=>rows.evaluateAll(els=>els.map(el=>({inputs:[...el.querySelectorAll('input')].map(e=>e.value),cells:[...el.querySelectorAll('td')].slice(0,7).map(e=>e.textContent?.trim()??'')})));

/** Operates only on unsaved rows in the known employee application form. The
 * existing request policy remains in force; no business delete is invoked. */
export async function verifySampleRowDelete(page:Page,check:BrowserCheck,result:{status:string;detail:string;evidence?:string}){
 if(!isSampleRowDelete(check)||result.status!=='passed')return;
 delete result.evidence;
 try{
  const url=new URL(page.url());if(url.origin!=='https://cdn.yibentushu.com'||!url.pathname.startsWith('/test-sample-apply/')||url.hash.split('?')[0]!=='#/home')throw Error('Blocked: 当前不是已约定的未提交申请表单。');
  const tables=page.locator('.pc-page-home .word-pc-sample-item table').filter({has:page.getByRole('columnheader',{name:'图书名称',exact:true})});
  const rows=tables.locator('tbody tr'),add=page.locator('.pc-page-home').getByText('继续添加样书',{exact:true}).filter({visible:true});
  if(await rows.count()!==1||await add.count()!==1)throw Error('Blocked: 行删除验证缺少一行初始基线和唯一添加入口。');
  const baseline=await snapshot(rows);
  await add.click({timeout:5000});await page.waitForFunction(()=>document.querySelectorAll('.pc-page-home .word-pc-sample-item tbody tr').length===2,undefined,{timeout:3000});
  if(await rows.count()!==2)throw Error('断言失败：添加后不是恰好两行样书。');
  for(let i=0;i<2;i++)if(await rows.nth(i).getByText('删除',{exact:true}).filter({visible:true}).count()!==1)throw Error('断言失败：第'+(i+1)+'行未提供唯一可见的删除入口。');
  // A local quantity marker distinguishes the newly added row. It cannot send
  // a request or create an application, and is removed with that unsaved row.
  const newQty=rows.nth(1).locator('td').nth(1).locator('input');if(await newQty.count()!==1)throw Error('Blocked: 新增行数量字段未唯一定位。');await newQty.fill('2');await newQty.blur();
  const originalBefore=await snapshot(rows.nth(0));
  await rows.nth(1).getByText('删除',{exact:true}).click({timeout:5000});
  await page.waitForFunction(()=>document.querySelectorAll('.pc-page-home .word-pc-sample-item tbody tr').length===1,undefined,{timeout:3000}).catch(()=>{});
  if(await rows.count()!==1)throw Error('断言失败：删除新增样书后行数没有从2减少到1。');
  if(JSON.stringify(await snapshot(rows))!==JSON.stringify(originalBefore)||JSON.stringify(originalBefore)!==JSON.stringify(baseline))throw Error('断言失败：删除新增样书时原有行内容发生变化或误删了原有行。');
  result.detail+='；本轮实际行数1→2→1；两行均有删除入口，删除带数量标记的新增行后，原有行输入与书目内容逐项保持。仅删除未提交表单行，未提交申请。';
 }catch(error){const message=error instanceof Error?error.message:'';result.status=message.startsWith('断言失败：')?'failed':'blocked';result.detail=message.startsWith('断言失败：')||message.startsWith('Blocked:')?message.replace(/^Blocked: /,''):'样书行删除未取得完整操作和行内容对照证据。';}
}
