import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
export async function readDepartmentCreationReceipts(root:string,profileId:string){
 const result=new Set<string>(),folder=path.join(root,'dify-web-modules','authorized-writes');
 let files:string[];try{files=await readdir(folder);}catch{return result;}
 const journals=files.filter(f=>/^[a-f0-9-]{36}\.json$/i.test(f));if(journals.length>200)throw Error('Blocked: 创建记录超出本轮核验上限，未静默截断。');
 for(const file of journals){
  const log=JSON.parse(await readFile(path.join(folder,file),'utf8')) as {schema?:number;profileId?:string;jobId?:string;attempts?:Array<{phase?:string;applyNo?:string}>};
  if(log.schema!==1||log.profileId!==profileId||file!==log.jobId+'.json')continue;
  for(const attempt of log.attempts??[])if(attempt.phase==='passed'&&/^\d{12}$/.test(attempt.applyNo??''))result.add(attempt.applyNo!);
 }
 return result;
}
