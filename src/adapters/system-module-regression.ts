import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { DifyWebModuleStore, moduleDigest, moduleTarget, type WebModuleDependencies, type WebModuleJob } from './dify-web-modules.js';
import type { DocumentProject } from './document-test-workflow.js';
import type { TestedSystem, FixedModule, BatchEntry, RegressionBatch, BatchView, AccountView, SystemModuleState } from '../domain/system-module-contract.js';

import {supportsDepartmentDatabase} from '../domain/regression-database-contract.js';
import {difyScriptPackage} from './dify-script-package.js';
import {mysqlBrowserStatus} from './mysql-readonly-browser.js';
import {assertDifyExportSafe} from './dify-export-policy.js';
import {difyBlocker} from './dify-case-readiness.js';
import {DifyBatchNotifier} from './dify-batch-notifier.js';

const uuid=z.string().uuid();
const terminal=new Set(['completed','error','blocked','cancelled','interrupted']);
const now=()=>new Date().toISOString();
const systemInput=z.object({id:uuid.optional(),name:z.string().trim().min(1).max(120),environment:z.string().trim().min(1).max(80),targetUrl:z.string().min(1).max(2000),databaseBinding:z.literal('department-supply-readonly').nullable().optional(),notifyFailures:z.boolean().optional(),notifyScreenshots:z.boolean().optional()});

/** Catalog identities are stable; versions and each batch's scope are immutable. */
export class SystemModuleRegression {
  private db:DatabaseSync;
  private active=new Map<string,AbortController>();
  private connections=new Map<string,AbortController>();
  private accounts:Record<string,AccountView>={};
  private closed=false;
  constructor(root:string,private store:DifyWebModuleStore,private deps:WebModuleDependencies,private notifier=new DifyBatchNotifier(root)){
    const dir=path.join(root,'system-module-regression');mkdirSync(dir,{recursive:true});
    this.db=new DatabaseSync(path.join(dir,'catalog.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,batch_id TEXT NOT NULL)');
    for(const batch of this.list<RegressionBatch>('batch'))if(['queued','running'].includes(batch.phase)){batch.phase='interrupted';batch.message='服务已重启，已保存本轮结果；不会自动重放。';this.save('batch',batch);}
    for(const batch of this.list<RegressionBatch>('batch'))if(batch.notification?.status==='sending'){batch.notification.status='uncertain';for(const item of batch.notification.items)if(item.status==='sending'){item.status='uncertain';item.detail='服务重启前未确认接收结果；请先核对测试群，不自动重发。';}this.save('batch',batch);}
  }
  private list<T>(kind:string):T[]{return this.db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>JSON.parse(String(r.payload)));}
  private save<T extends {id:string}>(kind:string,value:T):T{if(this.closed)throw Error('服务已停止。');this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(kind,value.id,JSON.stringify(value));return value;}
  private get<T>(kind:string,key:string):T{uuid.parse(key);const row=this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,key);if(!row)throw Error('系统、模块或回归批次不存在。');return JSON.parse(String(row.payload));}
  getSystem(key:string){return this.get<TestedSystem>('system',key);}
  getModule(key:string){return this.get<FixedModule>('module',key);}
  private occupied(systemId:string){return [...this.active.keys()].some(key=>this.get<RegressionBatch>('batch',key).systemId===systemId)||this.connections.has(systemId);}
  saveSystem(input:unknown){
    const data=systemInput.parse(input);const targetUrl=moduleTarget(data.targetUrl);const old=data.id?this.getSystem(data.id):undefined;
    if(old&&this.occupied(old.id))throw Error('系统窗口正在使用，请结束当前运行或账号连接后再修改。');
    // A different environment/URL gets an isolated browser profile, never inherited cookies.
    const changed=old&&(old.targetUrl!==targetUrl||old.environment!==data.environment);
    const value:TestedSystem={id:old?.id??randomUUID(),name:data.name,environment:data.environment,targetUrl,profileId:old&&!changed?old.profileId:randomUUID(),selectedModuleIds:old?.selectedModuleIds??[],createdAt:old?.createdAt??now(),updatedAt:now()};
    if(old&&!changed){if(old.accountProfiles)value.accountProfiles=old.accountProfiles;if(old.activeAccountId)value.activeAccountId=old.activeAccountId;}
    const binding=data.databaseBinding===undefined?(changed?undefined:old?.databaseBinding):data.databaseBinding;
    if(binding){if(!supportsDepartmentDatabase(targetUrl))throw Error('该测试库只允许绑定部门申样测试环境。');value.databaseBinding=binding;}
    value.notifyFailures=data.notifyFailures??old?.notifyFailures??false;value.notifyScreenshots=data.notifyScreenshots??old?.notifyScreenshots??false;
    if(value.notifyScreenshots&&!value.notifyFailures)throw Error('请先开启异常通知，再选择附带截图。');
    if(value.notifyFailures&&!this.notifier.configured())throw Error('本机尚未配置有效的测试群机器人地址；未开启通知。');
    if(changed)delete this.accounts[value.id];return this.save('system',value);
  }
  private accountProfile(system:TestedSystem){const id=system.activeAccountId??system.profileId;return id===system.profileId?{id,name:'我的账号'}:system.accountProfiles?.find(a=>a.id===id)??{id:system.profileId,name:'我的账号'};}
  addAccount(key:string,input:unknown){const data=z.object({name:z.string().trim().min(1).max(40)}).parse(input);const s=this.getSystem(key);if(this.occupied(key))throw Error('请结束本系统运行或账号连接后再添加账号。');s.accountProfiles??=[];if(s.accountProfiles.length>=10)throw Error('每个系统最多添加 10 个额外账号。');if(data.name==='我的账号'||s.accountProfiles.some(a=>a.name===data.name))throw Error('账号名称已存在。');s.accountProfiles.push({id:randomUUID(),name:data.name});s.updatedAt=now();return this.save('system',s);}
  selectAccount(key:string,input:unknown){const accountId=uuid.parse(input);const s=this.getSystem(key);if(this.occupied(key))throw Error('当前运行或账号连接尚未结束，不能切换账号。');if(accountId!==s.profileId&&!s.accountProfiles?.some(a=>a.id===accountId))throw Error('账号不属于当前系统。');s.activeAccountId=accountId;s.updatedAt=now();delete this.accounts[key];return this.save('system',s);}
  private hasProfile(system:TestedSystem,profileId:string){return system.profileId===profileId||system.accountProfiles?.some(a=>a.id===profileId);}
  saveSelection(systemId:string,input:unknown){const selected= z.array(uuid).max(100).parse(input);if(new Set(selected).size!==selected.length)throw Error('模块选择不能重复。');const system=this.getSystem(systemId);for(const key of selected){const m=this.getModule(key);if(m.systemId!==systemId||m.archived)throw Error('选择包含其他系统或已归档模块。');}system.selectedModuleIds=selected;system.updatedAt=now();return this.save('system',system);}
  async importModule(input:unknown){
    const data=z.object({systemId:uuid,moduleId:uuid.optional(),name:z.string().trim().min(1).max(120),fileName:z.string(),bytesBase64:z.string()}).parse(input);
    const system=this.getSystem(data.systemId);const old=data.moduleId?this.getModule(data.moduleId):undefined;
    if(old&&old.systemId!==system.id)throw Error('不能将其他系统模块的更新包导入此系统。');
    if(!old&&this.list<FixedModule>('module').some(m=>m.systemId===system.id&&m.name===data.name))throw Error('已有同名模块，请选择该模块更新用例包。');
    const version=await this.store.import({fileName:data.fileName,bytesBase64:data.bytesBase64,targetUrl:system.targetUrl,name:data.name});
    return this.attach(system.id,old?this.getModule(old.id):undefined,version.id,data.name);
  }
  /** Explicitly assign a legacy package; never guess its business system from a hostname. */
  attachLegacy(input:unknown){const data=z.object({systemId:uuid,versionId:uuid,name:z.string().trim().min(1).max(120)}).parse(input);this.getSystem(data.systemId);if(this.list<FixedModule>('module').some(m=>m.systemId===data.systemId&&m.name===data.name))throw Error('已有同名模块，请更新该模块。');return this.attach(data.systemId,undefined,data.versionId,data.name);}
  private attach(systemId:string,old:FixedModule|undefined,versionId:string,name:string){
    if(this.list<FixedModule>('module').some(m=>m.id!==old?.id&&m.systemId===systemId&&m.name===name))throw Error('已有同名模块，请更新该模块。');
    const source=this.store.getModule(versionId);const latest=old?.versions.at(-1);
    if(latest?.id===source.id){old!.name=name;old!.updatedAt=now();return this.save('module',old!);}
    const before=latest?this.store.getModule(latest.id).project.cases:[];const previous=new Map(before.map(c=>[c.id,c]));const current=new Map(source.project.cases.map(c=>[c.id,c]));
    const value:FixedModule=old??{id:randomUUID(),systemId,name,archived:false,versions:[],createdAt:now(),updatedAt:now()};
    value.name=name;value.updatedAt=now();value.versions.push({id:source.id,version:(latest?.version??0)+1,digest:source.digest,caseCount:source.project.cases.length,createdAt:now(),added:[...current.keys()].filter(k=>!previous.has(k)).length,removed:[...previous.keys()].filter(k=>!current.has(k)).length,changed:[...current.keys()].filter(k=>previous.has(k)&&moduleDigest(previous.get(k))!==moduleDigest(current.get(k))).length});
    return this.save('module',value);
  }
  archiveModule(key:string,input:unknown){const archived=z.boolean().parse(input);const m=this.getModule(key);m.archived=archived;m.updatedAt=now();this.save('module',m);if(archived){const s=this.getSystem(m.systemId);s.selectedModuleIds=s.selectedModuleIds.filter(id=>id!==key);this.save('system',s);}return m;}
  saveCore(key:string,input:unknown){const data=z.object({versionId:uuid,caseIds:z.array(z.string()).max(200),scope:z.enum(['core','starter']).default('core')}).parse(input);const m=this.getModule(key);if(m.versions.at(-1)?.id!==data.versionId)throw Error('模块已更新，请重新查看当前版本后保存范围。');const cases=this.store.getModule(data.versionId).project.cases;const known=new Set(cases.map(c=>c.id));if(new Set(data.caseIds).size!==data.caseIds.length||data.caseIds.some(id=>!known.has(id)))throw Error('范围包含重复或未知用例。');if(data.scope==='starter'){if(cases.some(c=>data.caseIds.includes(c.id)&&difyBlocker(c,'').blockerCode==='write-required'))throw Error('只读起步集合不能包含要求真实提交或落库的用例；原用例仍保留。');m.starterCaseIds=data.caseIds;m.starterVersionId=data.versionId;}else{m.coreCaseIds=data.caseIds;m.coreVersionId=data.versionId;}m.updatedAt=now();return this.save('module',m);}
  markdown(key:string,versionId?:string){return this.store.markdown(this.cases(key,versionId).version.id);}
  cases(key:string,versionId?:string){const m=this.getModule(key);const v=versionId?m.versions.find(v=>/^\d+$/.test(versionId)?v.version===Number(versionId):v.id===uuid.parse(versionId)):m.versions.at(-1);if(!v)throw Error('用例版本不存在。');return {module:m,version:v,cases:this.store.getModule(v.id).project.cases,readiness:this.store.readiness(v.id)};}
  state():SystemModuleState {
    const old=this.store.state();const modules=this.list<FixedModule>('module');const assigned=new Set(modules.flatMap(m=>m.versions.map(v=>v.id)));
    return {systems:this.list<TestedSystem>('system'),modules,batches:this.list<RegressionBatch>('batch').map(b=>this.view(b)),accounts:this.accounts,legacyModules:old.modules.filter(m=>!assigned.has(m.id)).map(m=>({id:m.id,name:m.name,targetUrl:m.targetUrl,caseCount:m.caseCount})),configured:old.configured,database:{connected:mysqlBrowserStatus().connected},notificationConfigured:this.notifier.configured()};
  }
  getBatch(key:string){return this.view(this.get<RegressionBatch>('batch',key));}
  private view(batch:RegressionBatch):BatchView {
    const jobs=batch.entries.flatMap(e=>{if(!e.jobId)return [];const {snapshot,executionProject,...j}=this.store.getJob(e.jobId);return [j];});
    const counts={passed:0,failed:0,blocked:0,error:0,not_executed:0,outside:0};
    for(const entry of batch.entries){const job=jobs.find(j=>j.id===entry.jobId);if(!job){counts.not_executed+=entry.selectedCaseIds?.length??entry.caseCount;continue;}for(const row of job.results)if(row.outOfScope)counts.outside++;else counts[row.status]++;}
    return {...batch,jobs,counts};
  }
  start(input:unknown){
    const data=z.object({systemId:uuid,moduleIds:z.array(uuid).min(1).max(100),requestId:uuid,runMode:z.enum(['fixed','assist']).optional(),scope:z.enum(['core','all','custom','starter']).optional(),caseSelections:z.record(z.string(),z.array(z.string()).min(1).max(200)).optional(),versionSelections:z.record(z.string(),uuid).optional()}).parse(input);
    const fingerprint=moduleDigest(data);const replay=this.replay(data.requestId,fingerprint);if(replay)return replay;
    const system=this.getSystem(data.systemId);if(new Set(data.moduleIds).size!==data.moduleIds.length)throw Error('模块选择不能重复。');
    const entries=data.moduleIds.map(key=>{const m=this.getModule(key);if(m.systemId!==system.id||m.archived)throw Error('模块不属于当前系统或已归档。');const v=m.versions.at(-1)!;if(data.versionSelections?.[m.id]&&data.versionSelections[m.id]!==v.id)throw Error('模块已更新，请刷新后再执行。');return {moduleId:m.id,moduleName:m.name,versionId:v.id,version:v.version,digest:v.digest,caseCount:v.caseCount};});
    for(const entry of entries){
      const m=this.getModule(entry.moduleId);const cases=this.store.getModule(entry.versionId).project.cases;const preset=data.scope==='starter'?{ids:m.starterCaseIds,version:m.starterVersionId,label:'只读起步集合'}:{ids:m.coreCaseIds,version:m.coreVersionId,label:'核心范围'};
      if(data.scope==='core'||data.scope==='starter'){if(preset.ids===undefined)throw Error('请在“查看用例”中保存该模块的'+preset.label+'，或选择全部用例。');if(preset.version!==entry.versionId)throw Error(preset.label+'属于旧版本，请重新保存范围。');}
      const chosen=data.scope==='custom'?data.caseSelections?.[m.id]:data.scope==='core'||data.scope==='starter'?preset.ids:undefined;
      if(data.scope==='custom'&&!chosen?.length)throw Error('请选择要执行的用例。');if(chosen){if(!chosen.length||new Set(chosen).size!==chosen.length||chosen.some(id=>!cases.some(c=>c.id===id)))throw Error('执行范围为空、重复或包含未知用例。');Object.assign(entry,{selectedCaseIds:cases.filter(c=>chosen.includes(c.id)).map(c=>c.id)});}
    }
    const account=this.accountProfile(system);const batch=this.create({...system,profileId:account.id},entries,data.requestId,fingerprint,undefined,{runMode:data.runMode??'assist',scope:data.scope??'all',accountName:account.name});this.saveSelection(system.id,data.moduleIds);return batch;
  }
  retest(key:string,input:unknown){
    const data=z.object({requestId:uuid,mode:z.enum(['failed','unfinished','all','selected','pending']).default('failed'),moduleId:uuid.optional(),caseIds:z.array(z.string()).min(1).max(200).optional()}).parse(input);
    const fingerprint=moduleDigest({parent:key,...data});const replay=this.replay(data.requestId,fingerprint);if(replay)return replay;
    const parent=this.getBatch(key);if(['queued','running'].includes(parent.phase))throw Error('本轮尚未结束。');
    // Retests always use the parent's version, target and environment, even after updates.
    if(data.caseIds&&new Set(data.caseIds).size!==data.caseIds.length)throw Error('选择不能包含重复用例。');
    if(data.mode==='selected'&&(!data.moduleId||!data.caseIds))throw Error('请选择模块和用例。');
    const entries=parent.entries.flatMap(e=>{const j=parent.jobs.find(j=>j.id===e.jobId);const {jobId,...snapshot}=e;if(data.mode==='all')return [snapshot];if(data.mode==='selected'){if(e.moduleId!==data.moduleId)return [];if(data.caseIds!.some(id=>!j?.results.some(r=>r.caseId===id)))throw Error('选择包含不属于原轮范围的用例。');return [{...snapshot,selectedCaseIds:data.caseIds!,confirmedCaseIds:(e.confirmedCaseIds??[]).filter(id=>data.caseIds!.includes(id))}];}if(!j)return ['unfinished','pending'].includes(data.mode)?[snapshot]:[];const ids=j.results.filter(r=>!r.outOfScope&&(data.mode==='failed'?r.status==='failed':data.mode==='pending'?r.status==='not_executed':['blocked','error','not_executed'].includes(r.status))).map(r=>r.caseId);return ids.length?[{...snapshot,selectedCaseIds:ids,confirmedCaseIds:(e.confirmedCaseIds??[]).filter(id=>ids.includes(id))}]:[];});
    if(!entries.length)throw Error('没有符合条件的模块。');
    const system=this.getSystem(parent.systemId);if(!this.hasProfile(system,parent.profileId))throw Error('系统环境已变更；请恢复原环境后重测历史批次，或在新环境新建回归。');
    return this.create({...system,profileId:parent.profileId,name:parent.systemName,environment:parent.environment,targetUrl:parent.targetUrl,...{databaseBinding:parent.databaseBinding}},entries,data.requestId,fingerprint,parent.id,{runMode:parent.runMode??'assist',scope:parent.scope??'all',...(parent.accountName?{accountName:parent.accountName}:{})});
  }
  private replay(requestId:string,fingerprint:string){const r=this.db.prepare('SELECT fingerprint,batch_id FROM requests WHERE id=?').get(requestId);if(!r)return undefined;if(r.fingerprint!==fingerprint)throw Error('同一请求编号不能对应不同范围。');return this.getBatch(String(r.batch_id));}
  confirmCase(key:string,input:unknown){
    const data=z.object({requestId:uuid,moduleId:uuid,caseId:z.string().min(1),confirmed:z.literal(true)}).parse(input);
    const fingerprint=moduleDigest({parent:key,...data});const replay=this.replay(data.requestId,fingerprint);if(replay)return replay;
    const parent=this.getBatch(key);if(['queued','running'].includes(parent.phase))throw Error('请等待本轮结束后确认并重测。');
    const entry=parent.entries.find(e=>e.moduleId===data.moduleId);const job=parent.jobs.find(j=>j.id===entry?.jobId);const row=job?.results.find(r=>r.caseId===data.caseId);
    if(!entry||!row?.needsConfirmation)throw Error('该用例没有等待前置数据确认。');
    const system=this.getSystem(parent.systemId);if(!this.hasProfile(system,parent.profileId))throw Error('系统环境已变更，请恢复原环境后重测。');
    const {jobId,...snapshot}=entry;
    return this.create({...system,profileId:parent.profileId,name:parent.systemName,environment:parent.environment,targetUrl:parent.targetUrl,...{databaseBinding:parent.databaseBinding}},[{...snapshot,selectedCaseIds:[data.caseId],confirmedCaseIds:[data.caseId]}],data.requestId,fingerprint,parent.id,{runMode:parent.runMode??'assist',scope:parent.scope??'all',...(parent.accountName?{accountName:parent.accountName}:{})});
  }
  private create(system:TestedSystem,entries:BatchEntry[],requestId:string,fingerprint:string,parentBatchId?:string,options?:{runMode:'fixed'|'assist';scope:'core'|'all'|'custom'|'starter';accountName?:string}){
    if(this.occupied(system.id))throw Error('该系统正在运行或连接账号，请等待或取消。');
    const batch:RegressionBatch={id:randomUUID(),requestId,systemId:system.id,systemName:system.name,environment:system.environment,targetUrl:system.targetUrl,profileId:system.profileId,notifyFailures:system.notifyFailures??false,notifyScreenshots:system.notifyScreenshots??false,...(system.databaseBinding?{databaseBinding:system.databaseBinding}:{}),createdAt:now(),updatedAt:now(),phase:'queued',entries,...(options??{}),message:'等待开始。',...(parentBatchId?{parentBatchId}:{})};
    this.db.exec('BEGIN IMMEDIATE');try{this.save('batch',batch);this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,fingerprint,batch.id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
    const controller=new AbortController();this.active.set(batch.id,controller);void this.run(batch,controller.signal).finally(()=>this.active.delete(batch.id));return this.getBatch(batch.id);
  }
  private async run(batch:RegressionBatch,signal:AbortSignal){
    try{batch.phase='running';batch.message='按模块顺序执行。';this.save('batch',batch);
      for(const entry of batch.entries){
        if(signal.aborted||this.closed)return;
        const job=this.store.start({moduleId:entry.versionId,requestId:randomUUID(),...(batch.runMode?{runMode:batch.runMode}:{}),...(entry.selectedCaseIds?{selectedCaseIds:entry.selectedCaseIds}:{}),...(entry.confirmedCaseIds?{confirmedCaseIds:entry.confirmedCaseIds}:{})},{profileId:batch.profileId,targetUrl:batch.targetUrl,moduleName:entry.moduleName,...(batch.databaseBinding?{databaseBinding:batch.databaseBinding}:{})});
        entry.jobId=job.id;batch.updatedAt=now();batch.message=`正在回归：${entry.moduleName}`;this.save('batch',batch);
        while(!terminal.has(this.store.getJob(job.id).phase)){if(signal.aborted||this.closed)return;await new Promise(r=>setTimeout(r,100));}
        if(signal.aborted||this.closed)return;
        const done=this.store.getJob(job.id);if(done.phase==='completed')this.accounts[batch.systemId]={state:'connected',message:'测试窗口已连接；权限以各用例实际结果为准。',profileId:batch.profileId,checkedAt:now(),...(done.databaseEvidence?{databaseEvidence:done.databaseEvidence}:{})};
      }
      if(!signal.aborted&&!this.closed){batch.phase='completed';batch.updatedAt=now();batch.message='本轮结束，请查看各模块实际结果。';this.save('batch',batch);await this.notify(batch);}
    }catch(error){if(!signal.aborted&&!this.closed){batch.phase='interrupted';batch.updatedAt=now();batch.message=error instanceof Error?error.message:'本轮未完成。';this.save('batch',batch);await this.notify(batch);}}
  }
  async cancel(key:string){const batch=this.get<RegressionBatch>('batch',key);const controller=this.active.get(key);if(!controller||!['queued','running'].includes(batch.phase))throw Error('本轮已结束，不能取消或改写历史结果。');controller.abort();batch.phase='cancelled';batch.updatedAt=now();batch.message='本轮已取消，未启动的模块保持未执行。';this.save('batch',batch);for(const e of batch.entries)if(e.jobId&&!terminal.has(this.store.getJob(e.jobId).phase))await this.store.cancel(e.jobId);return this.getBatch(key);}
  async continueBatch(key:string){const batch=this.getBatch(key);const waiting=batch.jobs.find(j=>j.phase==='awaiting-login');if(!waiting)throw Error('本轮当前没有等待登录。');await this.store.continue(waiting.id);return this.getBatch(key);}
  connect(key:string){
    const system=this.getSystem(key);if(this.occupied(key))throw Error('系统窗口正在使用，请在当前运行中继续登录。');
    const profile=this.accountProfile(system);
    const controller=new AbortController();this.connections.set(key,controller);this.accounts[key]={state:'connecting',message:'正在打开系统测试窗口。',profileId:profile.id};
    const project:DocumentProject={id:profile.id,name:system.name,fileName:'system-session',format:'text',browserProfileIsolation:true,targetUrl:system.targetUrl,sourceText:'',cases:[],createdAt:now(),updatedAt:now()};
    // inspect only uses the job identity for login handoff; no test or cloud call is started.
    const identity={id:randomUUID()} as WebModuleJob;
    void this.deps.inspect(project,identity,controller.signal,waiting=>{if(!this.closed&&!controller.signal.aborted)this.accounts[key]={state:waiting?'awaiting-login':'connecting',message:waiting?'请在系统测试窗口登录。':'正在检查系统页面。',profileId:profile.id};}).then(async()=>{
      if(this.closed||controller.signal.aborted)return;
      let databaseEvidence:AccountView['databaseEvidence'];
      if(system.databaseBinding){
        this.accounts[key]={state:'connecting',message:'正在只读核验当前账号的数据准备。',profileId:profile.id};
        try{databaseEvidence=await this.deps.database?.(project,controller.signal);}catch{}
        databaseEvidence??={binding:system.databaseBinding,capturedAt:now(),status:'blocked',checks:[{id:'connection',title:'测试库准备',status:'blocked',detail:'未完成本机只读核验；不会将未检查的数据当成已准备。'}]};
      }
      if(!this.closed&&!controller.signal.aborted)this.accounts[key]={state:'connected',message:'测试窗口已连接；权限以各用例实际结果为准。',profileId:profile.id,checkedAt:now(),...(databaseEvidence?{databaseEvidence}:{})};
    },()=>{if(!this.closed&&!controller.signal.aborted)this.accounts[key]={state:'error',message:'未完成账号连接，请重新连接并在测试窗口登录。',profileId:profile.id};}).finally(()=>this.connections.delete(key));return this.accounts[key];
  }
  async continueConnection(key:string){const s=this.getSystem(key);if(this.accounts[key]?.state!=='awaiting-login')throw Error('当前没有等待登录的账号连接。');await this.deps.continueLogin(this.accountProfile(s).id);return this.accounts[key];}
  async cancelConnection(key:string){const s=this.getSystem(key);this.connections.get(key)?.abort();await this.deps.cancel(this.accountProfile(s).id);delete this.accounts[key];return {state:'unknown',message:'已取消连接。'};}
  retryReports(key:string){const batch=this.getBatch(key);if(this.occupied(batch.systemId))throw Error('系统窗口正在使用。');const jobs=batch.entries.flatMap(e=>e.jobId?[this.store.getJob(e.jobId)]:[]).filter(j=>['error','interrupted','blocked'].includes(j.phase)&&j.executionFinished);if(!jobs.length)throw Error('没有可单独重试的汇总阶段。');const controller=new AbortController();this.active.set(batch.id,controller);batch.phase='running';batch.message='恢复 Dify 汇总，不重跑网页。';this.save('batch',batch);void (async()=>{try{for(const job of jobs){if(controller.signal.aborted||this.closed)return;await this.store.retry(job.id);while(!terminal.has(this.store.getJob(job.id).phase)){if(controller.signal.aborted||this.closed)return;await new Promise(r=>setTimeout(r,100));}}if(!this.closed&&!controller.signal.aborted){batch.phase='completed';batch.updatedAt=now();batch.message='汇总重试结束，网页原结果保留。';this.save('batch',batch);await this.notify(batch);}}catch(error){if(!this.closed&&!controller.signal.aborted){batch.phase='interrupted';batch.message=error instanceof Error?error.message:'汇总未完成。';this.save('batch',batch);}}finally{this.active.delete(batch.id);}})();return this.getBatch(batch.id);}
  private async notify(batch:RegressionBatch){
    if(this.closed)return;
    // A user's later disable takes effect even for an older enabled batch.
    if(!this.getSystem(batch.systemId).notifyFailures)return;
    try{await this.notifier.deliver(this.view(batch),batch.notification,record=>{if(!this.closed){batch.notification=record;this.save('batch',batch);}});}catch{if(!this.closed){batch.notification={status:'uncertain',updatedAt:now(),items:[{id:'summary',type:'summary',status:'uncertain',attempts:0,detail:'通知准备未完成；未改变原始测试结果。'}]};this.save('batch',batch);}}
  }
  async retryNotification(key:string){
    const batch=this.get<RegressionBatch>('batch',key);if(this.active.has(key)||['queued','running'].includes(batch.phase))throw Error('本轮仍在处理，请等待结束。');
    if(!batch.notifyFailures||!this.getSystem(batch.systemId).notifyFailures)throw Error('本轮未开启通知或系统通知已关闭。');
    if(!this.notifier.configured())throw Error('本机测试群机器人未配置，不能重试通知。');
    if(!batch.notification?.items.some(i=>i.status==='failed'||i.status==='pending'))throw Error('没有明确失败的通知可重试；接收结果不明的消息请先核对测试群。');
    const controller=new AbortController();this.active.set(key,controller);try{await this.notify(batch);return this.getBatch(key);}finally{this.active.delete(key);}
  }
  async scripts(key:string){const b=this.getBatch(key);if(['queued','running'].includes(b.phase))throw Error('请等待本轮结束后导出固定脚本。');return difyScriptPackage(b.entries.flatMap(e=>e.jobId?[this.store.getJob(e.jobId)]:[]));}
  report(key:string){const b=this.getBatch(key);const report=[`# ${b.systemName} 模块回归报告`,`批次：${b.id}`,`环境：${b.environment}`,`账号：${b.accountName??'历史默认账号'}`,`目标：${b.targetUrl}`,`时间：${b.createdAt}`,`批次状态：${b.phase}`,`异常通知：${b.notification?.status??'未启用'}（独立于用例结果）`,...(b.notification?.items.map(i=>`- ${i.type==='summary'?'异常摘要':'失败截图'}：${i.status}${i.detail?'；'+i.detail:''}`)??[]),`通过 ${b.counts.passed}；失败 ${b.counts.failed}；阻塞 ${b.counts.blocked}；异常 ${b.counts.error}；未执行 ${b.counts.not_executed}；范围外 ${b.counts.outside}`,...b.entries.map(e=>`\n## ${e.moduleName} · v${e.version}\n版本指纹：${e.digest}\n${e.jobId?this.store.renderReport(this.store.getJob(e.jobId)):'本模块未启动，不计为通过。'}`)].join('\n\n');assertDifyExportSafe(report);return report;}
  close(){if(this.closed)return;for(const [key,c] of this.active){c.abort();const b=this.get<RegressionBatch>('batch',key);if(!['queued','running'].includes(b.phase))continue;b.phase='interrupted';b.updatedAt=now();b.message='服务已停止，记录已保存，不会自动重放。';this.save('batch',b);}for(const c of this.connections.values())c.abort();this.closed=true;this.db.close();}
}
