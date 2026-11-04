import{Fragment,useEffect,useRef,useState}from'react';
import type{CoreChain,CoreRun,CoreStatus}from'../../src/domain/department-core-chains';

const names:Record<CoreStatus,string>={passed:'通过',failed:'失败',blocked:'阻塞',not_executed:'未执行'};
type Counts=Record<CoreStatus,number>;
const emptyCounts=():Counts=>({passed:0,failed:0,blocked:0,not_executed:0});
const evidenceRoot=(location.pathname.startsWith('/dify/')?'/dify':'')+'/api/system-module-regression/core-chains';
function CountsView({counts}:{counts:Counts}){return <span className="sm-module-counts">{Object.entries(counts).filter(([,count])=>count>0).map(([status,count])=><span key={status} className={`sm-${status==='not_executed'?'not-executed':status}`}>{count} {names[status as CoreStatus]}</span>)}</span>;}

export default function CoreChainResults({definitions,selected,run,expanded,onExpanded}:{definitions:CoreChain[];selected:string[];run?:CoreRun;expanded:string;onExpanded:(id:string)=>void}){
 const[filter,setFilter]=useState('all'),[detailId,setDetailId]=useState(''),panel=useRef<HTMLDivElement>(null);
 const selectionKey=selected.join('|');
 useEffect(()=>{setFilter('all');setDetailId('');},[run?.id,selectionKey,expanded]);
 useEffect(()=>{if(expanded)panel.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});},[expanded]);
 const rows=definitions.filter(c=>selected.includes(c.id)).map(c=>{const actual=run?.chains.find(v=>v.id===c.id),steps=actual?.steps??c.steps,counts=emptyCounts();for(const step of steps)counts[actual?.steps.find(s=>s.id===step.id)?.status??'not_executed']++;return{chain:actual??c,actual,steps,counts};});
 const total=emptyCounts();for(const row of rows)for(const status of Object.keys(total)as CoreStatus[])total[status]+=row.counts[status];
 const opened=rows.find(row=>row.chain.id===expanded),stepCount=rows.reduce((n,row)=>n+row.steps.length,0);
 return <section className="sm-results core-results" aria-label="核心用例运行结果">
  <div className="sm-heading"><div><h2>运行结果</h2><p className="sm-batch-range">核心用例 · {rows.length} 条链路 · {stepCount} 个步骤{run?' · '+new Date(run.createdAt).toLocaleString('zh-CN'):' · 尚未运行'}</p></div><CountsView counts={total}/></div>
  <div className="sm-table"><table><thead><tr><th>链路</th><th>步骤</th><th>结果</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.chain.id}><td>{row.chain.title}</td><td>{row.steps.length}</td><td><CountsView counts={row.counts}/></td><td><button className="sm-link" aria-expanded={expanded===row.chain.id} onClick={()=>onExpanded(expanded===row.chain.id?'':row.chain.id)}>{expanded===row.chain.id?'收起结果':'查看结果'}</button></td></tr>)}{!rows.length&&<tr><td colSpan={4} className="sm-empty">请先勾选链路。</td></tr>}</tbody></table></div>
  {opened&&<div className="sm-case-results" ref={panel}><div className="sm-heading"><h3>{opened.chain.title}</h3><CountsView counts={opened.counts}/><select aria-label="筛选核心步骤结果" value={filter} onChange={e=>{setFilter(e.target.value);setDetailId('');}}><option value="all">全部状态</option>{Object.entries(names).map(([status,name])=><option key={status} value={status}>{name}</option>)}</select></div>
   <div className="sm-table"><table><thead><tr><th>步骤（执行顺序）</th><th>结果</th><th>操作</th></tr></thead><tbody>{opened.steps.map((step,index)=>{const result=opened.actual?.steps.find(s=>s.id===step.id),status=result?.status??'not_executed';if(filter!=='all'&&filter!==status)return null;const evidence=result?.evidence&&run?`${evidenceRoot}/runs/${run.id}/evidence/${result.evidence}`:undefined;return <Fragment key={step.id}><tr><td>{index+1}. {step.title}</td><td><span className={'sm-badge sm-'+status}>{names[status]}</span></td><td><button className="sm-link" aria-expanded={detailId===step.id} onClick={()=>setDetailId(detailId===step.id?'':step.id)}>{detailId===step.id?'收起详情':'查看详情'}</button></td></tr>
    {detailId===step.id&&<tr className="sm-detail-row"><td colSpan={3}><div className="sm-evidence"><h3>{step.title}</h3><h4>预期结果</h4><p>{step.expected}</p><h4>实际结果</h4><p>{result?.detail??'该步骤在所选批次中未执行。'}</p>{result?.evidenceKind==='historical-submission'&&<p>证据方式：历史提交凭证＋本轮读回。</p>}{result?.references?.length?<p>关联申请：{result.references.join('、')}</p>:null}{result?.finishedAt&&<p>执行时间：{new Date(result.finishedAt).toLocaleString('zh-CN')}</p>}{evidence&&<p><a href={evidence} target="_blank" rel="noreferrer">查看执行截图</a></p>}<details><summary>关联原用例</summary>{result?.sources?.length?result.sources.map(source=><div key={source.caseId}><h4>{source.caseId} · {source.title}</h4><p>原始预期：{source.expected}</p></div>):<p>{step.caseIds.join('、')}</p>}</details></div></td></tr>}
   </Fragment>;})}{!opened.steps.some(step=>filter==='all'||('status'in step?step.status:'not_executed')===filter)&&<tr><td colSpan={3} className="sm-empty">该链路没有此状态的步骤。</td></tr>}</tbody></table></div>
  </div>}
 </section>;
}
