import{useEffect,useState}from'react';
import{coreChainStatus,type CoreState,type CoreRun,type CoreStatus}from'../../src/domain/department-core-chains';
import'./department-core-chains.css';
import CoreChainResults from'./department-core-chain-results';
const root='/api/system-module-regression/core-chains',names:Record<CoreStatus,string>={passed:'通过',failed:'失败',blocked:'阻塞',not_executed:'未执行'},active=(r:CoreRun)=>['queued','running','awaiting-login'].includes(r.phase);
async function api<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(root+url,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),v=await r.json();if(!r.ok)throw Error(v.error??'核心链路操作未完成。');return v;}
export default function DepartmentCoreChains({systemId,occupied,state,run,onRun,onRefresh}:{systemId:string;occupied:boolean;state?:CoreState;run?:CoreRun;onRun:(id:string)=>void;onRefresh:()=>Promise<void>}){
 const[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string[]>([]),[expanded,setExpanded]=useState('');
 const running=state?.runs.find(active),historical=!!run,blocked=occupied||!!running||busy;
 const definitions=run?.chains??state?.definitions??[];
 useEffect(()=>{setSelected((run?.chains??state?.definitions??[]).map(c=>c.id));setExpanded('');},[systemId,run?.id,!!state]);
 async function perform(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();await onRefresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="core-journeys" aria-label="核心用例链路">
  <div className="sm-heading"><h2>{historical?'本批次链路':'选择核心链路'}</h2><button className="sm-primary" disabled={blocked||!state?.supported||!selected.length} onClick={()=>void perform(async()=>{const next=await api<CoreRun>('/runs',{systemId,chainIds:selected,requestId:crypto.randomUUID()});onRun(next.id);})}>{running?'正在运行':historical?'按此范围重新运行':'运行所选链路'}</button></div>
  {error&&<p className="sm-error" role="alert">{error}</p>}
  {state&&!state.supported&&<p className="sm-error">请先选择部门申样测试系统并绑定测试数据库。</p>}
  <div className="sm-table"><table><thead><tr><th><input type="checkbox" aria-label="选择全部核心链路" disabled={blocked||historical} checked={definitions.length>0&&definitions.every(c=>selected.includes(c.id))} onChange={e=>setSelected(e.target.checked?definitions.map(c=>c.id):[])}/></th><th>业务链路（执行顺序）</th><th>步骤</th><th>本轮进度</th><th>结果</th></tr></thead><tbody>
   {definitions.map((chain,index)=>{const actual=run?.chains.find(c=>c.id===chain.id),status=actual?coreChainStatus(actual):'not_executed',passed=actual?.steps.filter(s=>s.status==='passed').length??0,first=actual?.steps.find(s=>s.status!=='passed'),working=!!running&&run?.id===running.id&&first?.startedAt&&!first.finishedAt;return <tr key={chain.id}><td><input type="checkbox" aria-label={'选择链路'+chain.title} checked={selected.includes(chain.id)} disabled={blocked||historical} onChange={e=>setSelected(ids=>e.target.checked?[...ids,chain.id]:ids.filter(id=>id!==chain.id))}/></td><td><button className="core-chain-name" title="查看链路步骤" aria-expanded={expanded===chain.id} onClick={()=>setExpanded(expanded===chain.id?'':chain.id)}><span>{index+1}.</span>{chain.title}</button></td><td>{chain.steps.length}</td><td><strong>{passed} / {chain.steps.length} 通过</strong><div className="core-step-summary">{working?'正在核验：'+first.title:actual?'':'尚未运行'}</div></td><td><span className={'sm-badge sm-'+(working?'not_executed':status)}>{working?'运行中':names[status]}</span></td></tr>;})}
   {!state&&<tr><td colSpan={5}>正在加载核心链路…</td></tr>}
  </tbody></table></div>
  <div className="core-run-meta"><span>{historical?'本批次':'已选'} {selected.length} 条链路 · {definitions.filter(c=>selected.includes(c.id)).reduce((n,c)=>n+c.steps.length,0)} 个步骤</span></div>
  {running&&<div className="core-live" role="status"><strong>{running.message}</strong>{running.phase==='awaiting-login'&&<button disabled={busy} onClick={()=>void perform(async()=>{await api('/runs/'+running.id+'/continue',{});})}>我已登录，继续</button>}<button disabled={busy} onClick={()=>void perform(async()=>{await api('/runs/'+running.id+'/cancel',{});})}>停止运行</button></div>}
  <CoreChainResults definitions={definitions} selected={selected} run={run} expanded={expanded} onExpanded={setExpanded}/>
 </section>;
}
