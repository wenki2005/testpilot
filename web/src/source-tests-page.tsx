import { useEffect, useState } from 'react';

type Job = { id: string; profileId: string; mode: string; status: string; events: Array<{type:string;itemType?:string}>; error?: string; result?: { reportPath:string; workspacePath:string; changedFiles:string[]; runtimeStatus?:string; commandCount?:number; modelRequests?:number; usage?:{input:number;output:number}; executions?:Array<{id:string;status:string;counts:Record<string,number>;durationMs:number;evidenceId:string}>; error?:string; assessment?: {summary:string;blockers:string[];findings:Array<{caseId:string;status:string;expected:string;actual:string;evidence:string}>} } };
type State = {profiles:Array<{id:string;name:string}>;jobs:Job[]};
const statuses:Record<string,string>={running:'执行中',candidate:'候选已生成',blocked:'未完成',cancelled:'已停止'};

export default function SourceTestsPage() {
  const [resumeFeedback,setResumeFeedback]=useState<Record<string,string>>({});
  const [state,setState]=useState<State>({profiles:[],jobs:[]});
  const [profile,setProfile]=useState(''),[mode,setMode]=useState('diagnose'),[goal,setGoal]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function refresh(){const response=await fetch('/api/source-test-jobs');if(!response.ok)throw Error('读取测试任务失败');const data=await response.json() as State;setState(data);}
  useEffect(()=>{let mounted=true;const read=()=>{if(mounted)void refresh().catch(e=>{if(mounted)setError(String(e.message));});};read();const timer=setInterval(read,2500);return()=>{mounted=false;clearInterval(timer);};},[]);
  async function start(){setBusy(true);setError('');try{const response=await fetch('/api/source-test-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:profile,goal,mode})});if(!response.ok){const data=await response.json();throw Error(data.error||'启动失败');}await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function stop(id:string){try{const response=await fetch(`/api/source-test-jobs/${id}/cancel`,{method:'POST'});if(!response.ok)throw Error('停止请求失败');await refresh();}catch(e){setError((e as Error).message);}}
  async function resume(id:string){try{const response=await fetch(`/api/source-test-jobs/${id}/resume`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({feedback:resumeFeedback[id]??''})});if(!response.ok){const data=await response.json();throw Error(data.error||'继续任务失败');}await refresh();}catch(e){setError((e as Error).message);}}
  return <div className="secondary-page"><div className="page-heading"><div><h1>代码测试 Agent</h1><p>结合项目源码分析失败、规划测试或生成可审核的回归候选。使用 TestPilot 设置中已配置的模型。</p></div></div>
    <section className="architecture-card source-agent-form"><label>测试项目<select aria-label="测试项目" value={profile} onChange={e=>setProfile(e.target.value)}><option value="">请选择已注册项目</option>{state.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>任务方式<select aria-label="任务方式" value={mode} onChange={e=>setMode(e.target.value)}><option value="diagnose">分析失败</option><option value="plan">规划测试</option><option value="generate">生成测试候选</option></select></label>
      <label>测试目标<textarea aria-label="测试目标" rows={6} maxLength={30000} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="填写需求、用例 ID、预期行为和需要调查的失败。"/></label>
      <p>在独立项目副本中分析；生成模式会实际执行测试、读取失败并继续调查。候选经审核后可纳入固定回归。依赖、账号或数据不足时会说明原因。</p>
      <button className="primary-button" disabled={busy||!profile||!goal.trim()||state.jobs.some(j=>j.status==='running')} onClick={()=>void start()}>{busy?'正在启动…':'开始处理'}</button>
      {error&&<p role="alert">{error}</p>}
    </section>
    {state.jobs.map(job=><section className="architecture-card" key={job.id}><h2>{statuses[job.status]||job.status} · {job.mode}</h2>
      {['blocked','cancelled'].includes(job.status)&&job.result&&<div><label>继续任务补充说明<textarea aria-label="继续任务补充说明" rows={2} maxLength={10000} value={resumeFeedback[job.id]??''} onChange={e=>setResumeFeedback(values=>({...values,[job.id]:e.target.value}))} placeholder="补充新证据、已恢复的数据或需要纠正的判断；已有测试会保留。"/></label><button disabled={state.jobs.some(j=>j.status==='running')} onClick={()=>void resume(job.id)}>继续未完成任务</button></div>}
      {job.status==='running'&&<button onClick={()=>void stop(job.id)}>停止任务</button>}
      <p>{job.result?.assessment?.summary||job.result?.error||job.error||'正在读取源码和分析测试目标…'}</p>
      {job.result?.assessment?.findings.map((finding,i)=><div key={i}><strong>{finding.caseId} · {finding.status}</strong><p>预期：{finding.expected}</p><p>实际：{finding.actual}</p><p>{finding.evidence}</p></div>)}
      {!!job.result?.assessment?.blockers.length&&<ul>{job.result.assessment.blockers.map((x,i)=><li key={i}>{x}</li>)}</ul>}
      {job.result?.runtimeStatus&&<p>实际执行：{job.result.runtimeStatus} · 执行 {job.result.commandCount??0} 次 · 模型请求 {job.result.modelRequests??0} 次{job.result.usage?` · 模型报告输入/输出 token：${job.result.usage.input}/${job.result.usage.output}`:''}</p>}
      {!!job.result?.executions?.length&&<ul>{job.result.executions.map(item=><li key={item.id}>{item.id} · {item.status} · 测试 {item.counts.tests??0} / 失败 {item.counts.fail??0} · {item.durationMs} ms · 证据 {item.evidenceId}</li>)}</ul>}
      {job.result&&<><p>报告：<code>{job.result.reportPath}</code></p><p>候选工作区：<code>{job.result.workspacePath}</code></p></>}
      <details><summary>运行进度</summary><pre>{job.events.map(e=>[e.type,e.itemType].filter(Boolean).join(' · ')).join('\n')||'等待执行事件'}</pre></details>
    </section>)}
  </div>;
}
