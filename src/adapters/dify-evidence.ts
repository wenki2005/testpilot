import type {Page,CDPSession} from 'playwright';

/** Dify only: a stalled compositor surface must not lose the live viewport
 * evidence. The fallback captures the same page view, never a previous image. */
export async function captureDifyPng(page:Page,existing?:CDPSession):Promise<Buffer>{
 const bounded=async<T>(operation:Promise<T>,ms:number)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Dify screenshot timeout')),ms);})]);}finally{clearTimeout(timer);}};
 const client=existing??await bounded(page.context().newCDPSession(page),2000);
 try{
  await bounded(page.bringToFront(),2000);
  for(const fromSurface of [true,false]){
   try{
    const shot=await bounded(client.send('Page.captureScreenshot',{format:'png',fromSurface,captureBeyondViewport:false}),3000);
    const png=Buffer.from(shot.data,'base64');
    if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid current PNG');
    return png;
   }catch(error){if(!fromSurface){
    if(error instanceof Error&&error.message==='Dify screenshot timeout')throw Error('Current Dify page screenshot unavailable.');
    // Some headless Chromium builds cannot capture a non-surface view. The
    // final bounded attempt still captures this live page and viewport.
    try{
     const png=await bounded(page.screenshot({type:'png',timeout:1800,animations:'disabled'}),2000);
     if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid current PNG');
     return png;
    }catch{throw Error('Current Dify page screenshot unavailable.');}
   }}
  }
  throw Error('Current Dify page screenshot unavailable.');
 }finally{if(!existing)await bounded(client.detach(),1000).catch(()=>{});}
}

/** Mask only populated personal fields; keep the real empty fields, default
 * avatar and page structure visible. Remove this temporary style after capture. */
export async function maskDifyProfileEvidence(page:Page,maskAvatar=false){
 const fields=[['.page-my .user-info .name','姓名已脱敏'],['.page-my .user-info .phone','手机号已脱敏'],['.page-my .user-info .company','组织已脱敏']];
 const rules:string[]=[];
 for(const [selector,label] of fields){
  const locator=page.locator(selector!);
  if(await locator.count()!==1||!(await locator.innerText()).trim())continue;
  rules.push(`${selector}{color:transparent!important;position:relative!important}${selector}::after{content:${JSON.stringify(label)};color:#526176;position:absolute;inset:0;font-size:12px;display:flex;align-items:center;white-space:nowrap}`);
 }
 if(maskAvatar)rules.push('.page-my .user-info .avatar img{visibility:hidden!important}.page-my .user-info .avatar::after{content:"头像已脱敏";position:absolute;inset:0;background:#edf1f6;color:#526176;display:flex;align-items:center;justify-content:center;font-size:11px}');
 return rules.length?page.addStyleTag({content:rules.join('\n')}):undefined;
}
