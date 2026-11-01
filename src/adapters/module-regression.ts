import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { RunRecord } from "../domain/types.js";
import { getApiSuiteCandidate, executeApprovedApiSuite, type ApiSuiteCandidate } from "./api-suite-workflow.js";
import { parseApiSuite } from "../storage/api-suite-loader.js";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const label = z.string().trim().min(1).max(250);
const uuid = z.string().uuid();
export type ModulePlan = { id: string; name: string; createdAt: string; reviewer: string; notes: string; suiteId: string; suiteDigest: string; digest: string; suite: ApiSuiteCandidate["suite"]; requiredEnvironment: string[] };
type State = "queued" | "preparing" | "executing" | "reporting" | "completed" | "blocked" | "error";
type Outcome = "not_executed" | "passed" | "failed" | "blocked" | "error";
export type ModuleExecution = {
  id: string; moduleId: string; moduleName: string; planDigest: string; suiteId: string; suiteDigest: string;
  method: "api-direct" | "dify"; executor: "api"; systemVersion: string; dataLabel: string; tester: string;
  createdAt: string; updatedAt: string; stage: State; outcome: Outcome; apiRunId?: string;
  workflowStatus: "not_used" | "pending" | "completed" | "error"; difyRuns: Array<{phase: string; id: string}>;
  results: Array<{caseId: string; title: string; status: Outcome}>;
  events: Array<{at: string; message: string}>; message: string;
};
type Dependencies = { candidate: typeof getApiSuiteCandidate; execute: typeof executeApprovedApiSuite; fetcher: typeof fetch };
export type ExecutionManifest = { schema: 1; run_id: string; module_id: string; plan_digest: string; suite_digest: string; case_ids: string[] };
export type WebPackageManifest = { schema: 1; phase: "web-package-check"; run_id: string; module_id: string; package_digest: string; case_ids: string[]; status_counts: Record<string, number> };

/** No model-generated instructions are accepted here. The Dify response must
 * reproduce this run's immutable manifest before any target request is made. */
function checkManifest(output: any, manifest: ExecutionManifest) {
  for (const key of ["schema", "run_id", "module_id", "plan_digest", "suite_digest", "case_ids"] as const) {
    if (JSON.stringify(output?.[key]) !== JSON.stringify(manifest[key])) throw new Error("Dify 执行清单与已审核版本不一致；未发送测试请求。");
  }
}
export function checkDispatch(output: any, manifest: ExecutionManifest) {
  checkManifest(output,manifest);
  if (output.phase !== "dispatch" || output.action !== "execute-approved-suite") throw new Error("Dify 未返回固定执行动作；未发送测试请求。");
}
export function checkWebPackageOutput(output: any, manifest: WebPackageManifest) {
  for (const key of ["schema", "phase", "run_id", "module_id", "package_digest", "case_ids", "status_counts"] as const) {
    if (JSON.stringify(output?.[key]) !== JSON.stringify(manifest[key])) throw new Error("Dify 返回的模块用例包清单与本地内容不一致；未开放执行。 ");
  }
  if (output.action !== "check-approved-web-package") throw new Error("Dify 未返回模块包检查结果；未开放执行。");
}
export function resultCounts(results: Array<{status: string}>) {
  const counts = {passed:0, failed:0, blocked:0, error:0, not_executed:0};
  for(const result of results) { if (!Object.hasOwn(counts,result.status)) throw new Error("未知执行结果。"); counts[result.status as keyof typeof counts]++; }
  return counts;
}
function validatePlan(candidate: ApiSuiteCandidate) {
  if(candidate.status !== "approved" || candidate.digest !== sha(candidate.suite)) throw new Error("需要已批准且内容指纹一致的 API 套件。");
  const suite = parseApiSuite(candidate.suite);
  if(!suite.baseUrl || !suite.cases.length || suite.cases.length > 20) throw new Error("模块需要锁定目标地址，并包含 1–20 条固定用例。");
  if(suite.fixtures || suite.principals || suite.cases.some(c => !["GET","HEAD","OPTIONS"].includes(c.request.method) || c.accessControl || (c.concurrency ?? 1) !== 1 || (c.request.timeoutMs ?? 10000) > 10000)) throw new Error("首版模块执行只支持普通只读接口，每条超时不超过 10 秒；写操作、fixture、角色矩阵及并发尚未接入。");
  if(suite.cases.some(c => !c.source || !c.requirementRefs?.length)) throw new Error("每条接口用例必须保留来源和需求/原用例编号。");
  const url=new URL(suite.baseUrl);
  if(url.username || url.password || url.search || url.hash) throw new Error("目标地址不得包含凭据或查询参数。");
  return suite;
}
export class ModuleRegressionStore {
  private db: DatabaseSync;
  private active = new Set<string>();
  private deps: Dependencies;
  constructor(private dataRoot: string, deps: Partial<Dependencies> = {}) {
    this.deps={candidate:getApiSuiteCandidate,execute:executeApprovedApiSuite,fetcher:fetch,...deps};
    mkdirSync(path.join(dataRoot,"module-regression"),{recursive:true});
    this.db=new DatabaseSync(path.join(dataRoot,"module-regression","records.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,run_id TEXT NOT NULL);");
    for(const run of this.list<ModuleExecution>("run")) if(!["completed","blocked","error"].includes(run.stage)) {
      run.stage="blocked"; run.message="服务中断，停止自动续跑；请检查已有证据后新建一轮。";
      if(!run.apiRunId) run.outcome="blocked";
      this.save("run",run);
    }
  }
  close(){this.db.close();}
  private save<T extends {id:string}>(kind:string,value:T) { this.db.prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(kind,value.id,JSON.stringify(value)); return value; }
  private list<T>(kind:string):T[] {return this.db.prepare("SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC").all(kind).map(r=>JSON.parse(String(r.payload)) as T);}
  private get<T>(kind:string,id:string):T {const row=this.db.prepare("SELECT payload FROM records WHERE kind=? AND id=?").get(kind,id); if(!row)throw new Error("记录不存在。");return JSON.parse(String(row.payload)) as T;}
  state(){return {plans:this.list<ModulePlan>("plan"),runs:this.list<ModuleExecution>("run"),difyConfigured:Boolean(process.env.TESTPILOT_DIFY_EXECUTION_API_KEY),workflowUrl:process.env.TESTPILOT_DIFY_EXECUTION_WORKFLOW_URL ?? ""};}
  async checkWebPackage(input: unknown) {
    const data = z.object({ schema: z.literal(1), phase: z.literal("web-package-check"), run_id: uuid, module_id: uuid, package_digest: z.string().regex(/^[0-9a-f]{64}$/), case_ids: z.array(z.string().min(1).max(80)).min(1).max(200), status_counts: z.record(z.string().max(40), z.number().int().nonnegative()) }).parse(input) as WebPackageManifest;
    if (new Set(data.case_ids).size !== data.case_ids.length || Object.values(data.status_counts).reduce((sum, count) => sum + count, 0) !== data.case_ids.length) throw new Error("模块清单条目或状态统计无效。");
    const key = process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;
    if (!key) throw new Error("尚未配置 Dify 模块执行工作流密钥；用例已保存在本地，但不能启动 Dify 模块测试。");
    const base = new URL(process.env.TESTPILOT_DIFY_BASE_URL ?? "https://api.dify.ai/v1");
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Dify 地址无效。");
    const response = await this.deps.fetcher(`${base.href.replace(/\/$/, "")}/workflows/run`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ inputs: { execution_json: JSON.stringify(data) }, response_mode: "blocking", user: `testpilot-web-package-${data.module_id}` }) });
    if (!response.ok) throw new Error(`Dify 模块包检查失败（HTTP ${response.status}）；请确认已导入支持 web-package-check 的工作流。`);
    const payload: any = await response.json();
    if (payload.data?.status !== "succeeded") {
      // The older published app supports dispatch/report, not web-package-check.
      if (!/missing identity|unsupported phase/.test(String(payload.data?.error))) throw new Error(`Dify 模块包检查节点失败；运行编号 ${payload.workflow_run_id ?? '未取得'}。`);
      const difyRunIds:string[]=[];
      for(let offset=0;offset<data.case_ids.length;offset+=20){
        const manifest:ExecutionManifest={schema:1,run_id:data.run_id,module_id:data.module_id,plan_digest:data.package_digest,suite_digest:data.package_digest,case_ids:data.case_ids.slice(offset,offset+20)};
        const next=await this.deps.fetcher(`${base.href.replace(/\/$/, '')}/workflows/run`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({inputs:{execution_json:JSON.stringify({...manifest,phase:'dispatch'})},response_mode:'blocking',user:`testpilot-web-package-${data.module_id}`})});
        if(!next.ok)throw new Error(`Dify 清单兼容检查 HTTP ${next.status}。`);
        const checked:any=await next.json();if(checked.data?.status!=='succeeded')throw new Error(`Dify 清单兼容检查失败；运行编号 ${checked.workflow_run_id??'未取得'}。`);
        const result=checked.data.outputs?.result;checkDispatch(typeof result==='string'?JSON.parse(result):result,manifest);if(typeof checked.workflow_run_id==='string')difyRunIds.push(checked.workflow_run_id);
      }
      return {status:'ok',message:`Dify 已按固定清单兼容协议核对 ${data.case_ids.length} 条编号与包指纹；尚未执行网页测试。`,protocol:'dispatch-compatible',workflowRunIds:difyRunIds};
    }
    const raw = payload.data.outputs?.result;
    const output = typeof raw === "string" ? JSON.parse(raw) : raw;
    checkWebPackageOutput(output, data);
    return { status: "ok", message: `Dify 已校验 ${data.case_ids.length} 条模块清单；测试内容与登录会话仍留在本机。`, workflowRunId: typeof payload.workflow_run_id === "string" ? payload.workflow_run_id : undefined };
  }
  async register(input:unknown) {
    const data=z.object({name:label,suiteId:uuid,reviewer:label,notes:z.string().trim().min(5).max(3000),confirmed:z.literal(true)}).parse(input);
    const candidate=await this.deps.candidate(data.suiteId); if(!candidate)throw new Error("API 套件不存在。");
    const suite=validatePlan(candidate);
    const requiredEnvironment=[...new Set([...JSON.stringify(suite).matchAll(/\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(m=>m[1]!))];
    const immutable={name:data.name,suiteId:candidate.id,suiteDigest:candidate.digest,suite,requiredEnvironment};
    const plan:ModulePlan={...immutable,id:randomUUID(),createdAt:new Date().toISOString(),reviewer:data.reviewer,notes:data.notes,digest:sha(immutable)};
    return this.save("plan",plan);
  }
  async start(input:unknown) {
    const data=z.object({moduleId:uuid,method:z.enum(["api-direct","dify"]),systemVersion:label,dataLabel:label,tester:label,requestId:uuid,allowNetwork:z.boolean().default(false)}).parse(input);
    const plan=this.get<ModulePlan>("plan",data.moduleId);
    const fingerprint=sha({...data,requestId:undefined});
    const old=this.db.prepare("SELECT fingerprint,run_id FROM requests WHERE id=?").get(data.requestId);
    if(old){if(old.fingerprint!==fingerprint)throw new Error("请求编号对应不同执行内容。");return this.get<ModuleExecution>("run",String(old.run_id));}
    if(this.active.size>=2)throw new Error("已有两轮运行，请稍后再试。");
    const time=new Date().toISOString();
    const run:ModuleExecution={id:randomUUID(),moduleId:plan.id,moduleName:plan.name,planDigest:plan.digest,suiteId:plan.suiteId,suiteDigest:plan.suiteDigest,method:data.method,executor:"api",systemVersion:data.systemVersion,dataLabel:data.dataLabel,tester:data.tester,createdAt:time,updatedAt:time,stage:"queued",outcome:"not_executed",workflowStatus:data.method==="dify"?"pending":"not_used",difyRuns:[],results:plan.suite.cases.map(c=>({caseId:c.id,title:c.title,status:"not_executed"})),events:[],message:"已保存任务，等待执行。"};
    this.db.exec("BEGIN IMMEDIATE");
    try{this.save("run",run);this.db.prepare("INSERT INTO requests VALUES(?,?,?)").run(data.requestId,fingerprint,run.id);this.db.exec("COMMIT");}catch(e){this.db.exec("ROLLBACK");throw e;}
    this.active.add(run.id);
    void this.execute(run,plan,data.allowNetwork).finally(()=>this.active.delete(run.id));
    return run;
  }
  private event(run:ModuleExecution,stage:State,message:string){run.stage=stage;run.message=message;run.updatedAt=new Date().toISOString();run.events.push({at:run.updatedAt,message});this.save("run",run);}
  private async callDify(run:ModuleExecution,phase:"dispatch"|"report",manifest:ExecutionManifest,results?:ModuleExecution["results"]) {
    const key=process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;
    if(!key)throw new Error("未配置 Dify 执行工作流密钥；未开始目标测试。");
    const base=new URL(process.env.TESTPILOT_DIFY_BASE_URL ?? "https://api.dify.ai/v1");
    if(base.protocol!=="https:" || base.username || base.password || base.search || base.hash)throw new Error("Dify 地址无效。");
    const safeResults=results?.map(r=>({case_id:r.caseId,status:r.status}));
    const response=await this.deps.fetcher(`${base.href.replace(/\/$/,"")}/workflows/run`,{method:"POST",redirect:"error",signal:AbortSignal.timeout(90000),headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({inputs:{execution_json:JSON.stringify({phase,...manifest,...(safeResults?{results:safeResults}:{})})},response_mode:"blocking",user:`testpilot-module-${run.id}`})});
    if(!response.ok)throw new Error(`Dify 执行工作流 HTTP ${response.status}。`);
    const payload:any=await response.json();
    if(typeof payload.workflow_run_id==="string"){run.difyRuns.push({phase,id:payload.workflow_run_id});this.save("run",run);}
    if(payload.data?.status!=="succeeded")throw new Error("Dify 执行工作流失败，请查看关联日志。");
    const raw=payload.data.outputs?.result;
    return typeof raw==="string"?JSON.parse(raw):raw;
  }
  private async execute(run:ModuleExecution,plan:ModulePlan,allowNetwork:boolean) {
    try{
      this.event(run,"preparing","正在核对已审核模块、套件版本和环境。");
      const expected=sha({name:plan.name,suiteId:plan.suiteId,suiteDigest:plan.suiteDigest,suite:plan.suite,requiredEnvironment:plan.requiredEnvironment});
      const current=await this.deps.candidate(plan.suiteId);
      if(expected!==plan.digest || !current || current.digest!==plan.suiteDigest || sha(current.suite)!==plan.suiteDigest)throw new Error("已审核模块或套件内容发生变化；未发送测试请求。");
      validatePlan(current);
      const missing=plan.requiredEnvironment.filter(name=>!process.env[name]);
      if(missing.length)throw new Error(`缺少本机测试凭据/数据配置：${missing.join(", ")}；未发送测试请求。`);
      const target=new URL(plan.suite.baseUrl!);
      if(!["localhost","127.0.0.1","[::1]"].includes(target.hostname) && !allowNetwork)throw new Error("尚未允许本轮访问外部测试目标；未发送测试请求。");
      const manifest:ExecutionManifest={schema:1,run_id:run.id,module_id:plan.id,plan_digest:plan.digest,suite_digest:plan.suiteDigest,case_ids:plan.suite.cases.map(c=>c.id)};
      if(run.method==="dify"){
        this.event(run,"preparing","Dify 正在核对固定清单；尚未执行目标请求。");
        checkDispatch(await this.callDify(run,"dispatch",manifest),manifest);
      }
      this.event(run,"executing","正在使用已审核 API 执行器发送固定请求并检查断言。");
      const executed=await this.deps.execute(plan.suiteId,{allowNetwork,allowMutations:false,allowConcurrency:false,signal:AbortSignal.timeout(180000)});
      const record=executed.record;
      run.apiRunId=record.runId;
      run.results=plan.suite.cases.map(c=>{const actual=record.results.find(r=>r.caseId===c.id);return {caseId:c.id,title:c.title,status:actual?.status??"not_executed"};});
      run.outcome=record.status;
      // Persist real results before cloud reporting; a report outage cannot change a failed check into a pass.
      this.event(run,"reporting","实际执行结果与证据已保存。");
      if(run.method==="dify"){
        try{
          const report=await this.callDify(run,"report",manifest,run.results);
          checkManifest(report,manifest);
          if(report?.run_id!==run.id || report?.plan_digest!==plan.digest || report?.phase!=="report" || JSON.stringify(report?.counts)!==JSON.stringify(resultCounts(run.results)))throw new Error("Dify 汇总与实际结果不一致。");
          run.workflowStatus="completed";
        }catch{run.workflowStatus="error";this.event(run,"error","接口执行结果已保存，但 Dify 汇总失败；保留实际状态，请检查工作流日志。");return;}
      }
      this.event(run,"completed","本轮已完成；通过/失败来自固定断言，完整证据见关联 API 报告。");
    }catch(error){
      if(run.method==="dify")run.workflowStatus="error";
      run.outcome=run.apiRunId?run.outcome:"blocked";
      const message=error instanceof Error && /^(Dify |已审核|需要已批准|缺少本机|尚未允许|未配置|首版模块)/.test(error.message)?error.message:"执行异常或超时；未完成的检查不计为通过。";
      this.event(run,"blocked",message);
    }
  }
  async unifiedRuns() {
    const modules=this.list<ModuleExecution>("run");const linked=new Set(modules.map(r=>r.apiRunId).filter(Boolean));
    const items:any[]=modules.map(r=>({...r,id:r.id,recordType:"module",counts:resultCounts(r.results)}));
    const root=path.join(this.dataRoot,"api-runs");
    for(const id of await readdir(root).catch(()=>[])){
      if(!uuid.safeParse(id).success || linked.has(id))continue;
      try{const r=JSON.parse(await readFile(path.join(root,id,"run.json"),"utf8")) as RunRecord;items.push({id:r.runId,apiRunId:r.runId,recordType:"api",moduleId:"unassigned",moduleName:"未归类 API 套件",suiteName:r.suiteName,method:"api-direct",executor:"api",createdAt:r.startedAt,stage:"completed",outcome:r.status,workflowStatus:"not_used",counts:resultCounts(r.results),message:"历史 API 运行，未绑定模块和环境版本。"});}catch{/* corrupt artifacts excluded */}
    }
    return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
}
