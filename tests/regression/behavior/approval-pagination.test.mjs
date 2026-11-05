import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {verifyConnectedEvidence} from '../../../dist/adapters/regression/scenarios/connected-systems.js';
import {departmentOaTemplateBaseline} from '../../../dist/adapters/regression/config/approval-templates.js';
test('approval readback collects real next page; duplicate pages remain blocked',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:720}});let duplicate=false;
 const keys=Array.from({length:11},(_,i)=>'OWN'+i),status=k=>keys.indexOf(k)===9?1:keys.indexOf(k)===10?2:0;
 const db={count:async()=>11,snapshot:async k=>({apply_no:k,book_usage:1,examine_status:status(k),lock_status:0,sp_id:'SYNTHETIC',template_id:departmentOaTemplateBaseline[0].templateId,reject_reason:status(k)===2?'合成驳回理由':''})};
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin==='https://testapi.yibentushu.com'){
  let b={code:200};if(u.pathname.endsWith('/getInfo'))b.user={userId:7};else if(u.pathname.endsWith('/myList')){const n=Number(u.searchParams.get('pageNum')??1);b.total=11;b.rows=(n===1||duplicate?keys.slice(0,10):keys.slice(10)).map(k=>({applyNo:k,examineStatus:status(k)}));}else{const k=u.pathname.split('/').at(-1);b.data={applyNo:k,examineStatus:status(k),lockStatus:0,timeline:[{node:'审批',desc:status(k)===2?'合成驳回理由':'合成进度'}]};}
  return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(b)});
 }
 const html=`<meta charset="utf-8"><script>const api='https://testapi.yibentushu.com/supply-api/';if(location.hash==='#/apply'){fetch(api+'getInfo');fetch(api+'dept/book/apply/myList?pageNum=1&pageSize=10').then(()=>{document.body.innerHTML='<button>下一页</button>';document.querySelector('button').onclick=()=>fetch(api+'dept/book/apply/myList?pageNum=2&pageSize=10')})}else if(location.hash.startsWith('#/apply-detail/'))fetch(api+'dept/book/apply/progress/'+location.hash.split('/').at(-1)).then(r=>r.json()).then(b=>{document.body.innerHTML='<main class="pc-page-apply-detail"><ul class="info-step"><li><div class="title">审批</div>'+b.data.timeline[0].desc+'</li></ul></main>'})</script>`;
 return route.fulfill({contentType:'text/html;charset=utf-8',body:html});});
 const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home',c={expected:'通过template_id创建审批单，审批进度/结果/驳回理由回传至审批详情页',source:'数据接口层 › 企微审批接口',steps:[],preconditions:[]};
 for(const mode of [false,true]){duplicate=mode;await page.goto('about:blank');await page.goto(target);const r={status:'passed',detail:''};await verifyConnectedEvidence(page,c,r,target,async()=> 'synthetic.png',db,async()=>new Set(keys));assert.equal(r.status,mode?'blocked':'passed',r.detail);assert.match(r.detail,mode?/分页重复/:/本人列表11条/);}
 duplicate=false;const receipts=async()=>new Set(keys.filter(k=>status(k)!==0));
 for(const valid of [false,true]){await page.goto('about:blank');await page.goto(target);const r={status:'passed',detail:''};await verifyConnectedEvidence(page,c,r,target,async()=> 'synthetic.png',db,receipts,async()=>valid?[{applyNo:'OWN9',verifiedAt:new Date(Date.now()-60000).toISOString(),approvalStatus:0,lockStatus:0,orderPresent:false}]:[]);assert.equal(r.status,valid?'passed':'blocked',r.detail);assert.match(r.detail,valid?/原提交断点/:/缺关联的真实提交/);}
});
