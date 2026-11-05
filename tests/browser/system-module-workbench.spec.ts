import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let server:ChildProcess;let base:string;let owned:string;
const pack=(expected:string)=>Buffer.from('case_id,title,steps,expected_result\none,页面提示文案「模块样例」,"[{""action"":""assertText"",""text"":""模块样例""}]",'+expected);
test.beforeAll(async()=>{const root=path.resolve(process.env.TESTPILOT_TEST_RUN_DIR??'test-artifacts');await mkdir(root,{recursive:true});owned=await mkdtemp(path.join(root,'system-ui-'));const listener=createServer();listener.listen(0,'127.0.0.1');await new Promise<void>(resolve=>listener.once('listening',resolve));const address=listener.address();if(!address||typeof address==='string')throw Error('端口未分配');const port=address.port;await new Promise<void>(resolve=>listener.close(()=>resolve()));base=`http://127.0.0.1:${port}`;server=spawn(process.execPath,['dist/server/http-server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),TESTPILOT_DATA_DIR:owned,TESTPILOT_BROWSER_CDP_ENDPOINT:'',TESTPILOT_DIFY_WECOM_WEBHOOK:''},stdio:'ignore',windowsHide:true});for(let i=0;i<150;i++){try{if((await fetch(base+'/api/system-module-regression')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('UI 测试服务未启动');});
test.afterAll(async()=>{server?.kill();await new Promise(r=>setTimeout(r,700));const root=path.resolve(process.env.TESTPILOT_TEST_RUN_DIR??'test-artifacts');if(path.dirname(path.resolve(owned))!==root||!path.basename(owned).startsWith('system-ui-'))throw Error('拒绝清理非测试目录');await rm(owned,{recursive:true,force:true,maxRetries:5,retryDelay:200});});

test('creating a new system stays selected after polling and does not jump to an existing system',async({page,request})=>{
  await request.post(base+'/api/system-module-regression/systems',{data:{name:'已存在系统',environment:'测试',targetUrl:'https://example.com/old'}});
  await page.goto(base+'/?page=dify-regression');await page.getByRole('button',{name:'新增系统',exact:true}).click();
  await page.getByRole('textbox',{name:'系统名称',exact:true}).fill('新增系统验证');await page.getByRole('textbox',{name:'被测网址',exact:true}).fill('https://example.com/new');await page.getByRole('button',{name:'保存系统',exact:true}).click();
  const state=await(await request.get(base+'/api/system-module-regression')).json();const system=state.systems.find((s:{name:string})=>s.name==='新增系统验证');
  await expect(page.getByRole('combobox',{name:'选择系统',exact:true})).toHaveValue(system.id);await page.waitForTimeout(2100);await expect(page.getByRole('combobox',{name:'选择系统',exact:true})).toHaveValue(system.id);
});

test('upload and update keep one fixed module, preserve expectations by version, and restore system selection',async({page,request})=>{
  const create=await request.post(base+'/api/system-module-regression/systems',{data:{name:'模块管理验证',environment:'测试',targetUrl:'https://example.com/module'}});const system=await create.json();await page.goto(base+'/?page=dify-regression&system='+system.id);await page.getByRole('button',{name:'管理模块',exact:true}).click();
  await page.getByRole('textbox',{name:'模块名称',exact:true}).fill('固定模块');await page.getByLabel('上传模块用例包',{exact:true}).setInputFiles({name:'cases.csv',mimeType:'text/csv',buffer:pack('旧版预期：模块样例')});await page.getByRole('button',{name:'保存模块',exact:true}).click();await expect(page.getByRole('combobox',{name:'选择要更新的模块',exact:true})).not.toHaveValue('');
  await page.getByLabel('上传模块用例包',{exact:true}).setInputFiles({name:'updated.csv',mimeType:'text/csv',buffer:pack('新版预期：模块样例')});await page.getByRole('button',{name:'保存模块',exact:true}).click();await expect(page.getByRole('status').last()).toContainText('v2');
  let state=await(await request.get(base+'/api/system-module-regression')).json();const modules=state.modules.filter((m:{systemId:string})=>m.systemId===system.id);expect(modules).toHaveLength(1);expect(modules[0].versions).toHaveLength(2);const old=await(await request.get(base+'/api/system-module-regression/modules/'+modules[0].id+'?version=1')).json();expect(old.cases[0].expected).toBe('旧版预期：模块样例');
  await page.getByRole('button',{name:'关闭',exact:true}).click();await request.post(base+'/api/system-module-regression/systems/'+system.id+'/selection',{data:{moduleIds:[modules[0].id]}});await page.reload();await expect(page.getByRole('checkbox',{name:'选择固定模块',exact:true})).toBeChecked();await page.getByRole('checkbox',{name:'选择固定模块',exact:true}).uncheck();await page.getByRole('button',{name:'恢复上次选择',exact:true}).click();await expect(page.getByRole('checkbox',{name:'选择固定模块',exact:true})).toBeChecked();
  const second=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'隔离系统',environment:'测试',targetUrl:'https://example.com/another'}})).json();await page.reload();await page.getByRole('combobox',{name:'选择系统',exact:true}).selectOption(second.id);await expect(page.getByRole('checkbox',{name:'选择固定模块',exact:true})).toHaveCount(0);
});

test('narrow screen keeps the page within the viewport',async({page,request})=>{const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'窄屏验证'+randomUUID().slice(0,6),environment:'测试环境',targetUrl:'https://example.com/mobile'}})).json();await page.setViewportSize({width:390,height:844});await page.goto(base+'/?page=dify-regression&system='+system.id);await expect(page.getByRole('combobox',{name:'选择系统',exact:true})).toHaveValue(system.id);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);});

test('department database binding is a simple saved checkbox; other systems do not display this source',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'数据库绑定验证',environment:'测试环境',targetUrl:'https://cdn.yibentushu.com/test-sample-apply/index.html#/home'}})).json();
 await page.goto(base+'/?page=dify-regression&system='+system.id);await page.getByRole('button',{name:'系统设置',exact:true}).click();await page.getByRole('checkbox',{name:'核对部门申样测试库（只读）',exact:true}).check();await page.getByRole('button',{name:'保存系统',exact:true}).click();await expect(page.getByText('数据库待连接',{exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'系统设置',exact:true}).click();await expect(page.getByRole('checkbox',{name:'核对部门申样测试库（只读）',exact:true})).toBeChecked();await page.getByRole('checkbox',{name:'核对部门申样测试库（只读）',exact:true}).uncheck();await page.getByRole('button',{name:'保存系统',exact:true}).click();await expect(page.getByText('数据库待连接',{exact:true})).toHaveCount(0);
});

test('Markdown import, priority filtering and saved core selection preserve all source cases',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'核心范围验证',environment:'测试',targetUrl:'https://example.com/core'}})).json();
 const md='# 模块\n\n## core-1 | 核心提示\n- 优先级：P0\n### 预期结果\n完整原始预期一\n\n## extended-2 | 扩展提示\n- 优先级：P2\n### 预期结果\n完整原始预期二\n';
 const result=await request.post(base+'/api/system-module-regression/modules/import',{data:{systemId:system.id,name:'核心集合模块',fileName:'module.md',bytesBase64:Buffer.from(md).toString('base64')}});expect(result.ok()).toBe(true);const module=await result.json();
 await page.goto(base+'/?page=dify-regression&system='+system.id);await expect(page.getByRole('combobox',{name:'执行模式',exact:true})).toHaveValue('fixed');await page.getByRole('button',{name:'查看用例',exact:true}).click();await page.getByRole('combobox',{name:'筛选优先级',exact:true}).selectOption('P0');await expect(page.getByRole('checkbox',{name:'选择用例 extended-2',exact:true})).toHaveCount(0);await page.getByRole('checkbox',{name:'全选当前用例',exact:true}).check();await page.getByRole('button',{name:'保存为核心',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'选择用例 core-1',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'选择用例 extended-2',exact:true})).not.toBeChecked();
 const pack=await(await request.get(base+'/api/system-module-regression/modules/'+module.id)).json();expect(pack.cases).toHaveLength(2);expect(pack.module.coreCaseIds).toEqual(['core-1']);const exported=await(await request.get(base+'/api/system-module-regression/modules/'+module.id+'/markdown')).text();expect(exported).toContain('完整原始预期一');expect(exported).toContain('完整原始预期二');expect(exported).toContain('优先级：P0');const before=page.url();const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'导出 MD',exact:true}).click();const file=await downloading;expect(file.suggestedFilename()).toBe('module-cases.md');expect(page.url()).toBe(before);
});

test('named accounts are added and selected only within their Dify system',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'命名账号验证',environment:'测试',targetUrl:'https://example.com/accounts'}})).json();await page.goto(base+'/?page=dify-regression&system='+system.id);await page.getByRole('button',{name:'系统设置',exact:true}).click();await page.getByRole('textbox',{name:'新增测试账号',exact:true}).fill('审批测试账号');await page.getByRole('button',{name:'添加账号',exact:true}).click();await expect(page.getByRole('textbox',{name:'新增测试账号',exact:true})).toHaveValue('');await page.getByRole('button',{name:'关闭',exact:true}).click();
 const state=await(await request.get(base+'/api/system-module-regression')).json();const saved=state.systems.find((s:{id:string})=>s.id===system.id);await page.getByRole('combobox',{name:'选择测试账号',exact:true}).selectOption(saved.accountProfiles[0].id);await page.reload();await expect(page.getByRole('combobox',{name:'选择测试账号',exact:true})).toHaveValue(saved.accountProfiles[0].id);
});

test('notification settings stay folded and cannot enable delivery without a configured test group',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'通知关闭验证',environment:'测试',targetUrl:'https://example.com/notification'}})).json();
 await page.goto(base+'/?page=dify-regression&system='+system.id);await page.getByRole('button',{name:'系统设置',exact:true}).click();await expect(page.getByRole('checkbox',{name:'将异常摘要发送到测试群',exact:true})).not.toBeVisible();await page.getByText('异常通知',{exact:true}).click();await expect(page.getByRole('checkbox',{name:'将异常摘要发送到测试群',exact:true})).toBeDisabled();await expect(page.getByRole('checkbox',{name:'同时发送本轮失败截图',exact:true})).not.toBeChecked();await page.getByRole('button',{name:'保存系统',exact:true}).click();
 const state=await(await request.get(base+'/api/system-module-regression')).json();expect(state.notificationConfigured).toBe(false);expect(state.systems.find((s:{id:string})=>s.id===system.id).notifyFailures).toBe(false);
});

test('unsafe export stays in the Dify page and explains the rejection without modifying the source',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'导出原文保护',environment:'测试',targetUrl:'https://example.com/export'}})).json();const expected='password=ONLY_UNIT_TEST_CREDENTIAL';const module=await(await request.post(base+'/api/system-module-regression/modules/import',{data:{systemId:system.id,name:'原始用例模块',fileName:'cases.csv',bytesBase64:pack(expected).toString('base64')}})).json();
 await page.goto(base+'/?page=dify-regression&system='+system.id);await page.getByRole('button',{name:'查看用例',exact:true}).click();const before=page.url();await page.getByRole('link',{name:'导出 MD',exact:true}).click();await expect(page.getByRole('alert')).toContainText('原用例和历史结果未修改');expect(page.url()).toBe(before);const cases=await(await request.get(base+'/api/system-module-regression/modules/'+module.id)).json();expect(cases.cases[0].expected).toBe(expected);
});

test('a stalled Dify catalog shows a bounded load error and can recover without overlapping polls or losing saved modules',async({page,request})=>{
 test.setTimeout(30000);
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'加载恢复验证',environment:'测试',targetUrl:'https://example.com/retry'}})).json();
 let recover=false,calls=0;
 await page.route('**/api/system-module-regression',async route=>{calls++;if(recover)return route.continue();await new Promise(resolve=>setTimeout(resolve,14000));await route.abort().catch(()=>{});});
 await page.goto(base+'/?page=dify-regression&system='+system.id);
 await expect(page.getByRole('alert')).toContainText('本地服务响应超时',{timeout:13000});
 expect(calls).toBe(1);
 recover=true;await page.getByRole('button',{name:'重新加载',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'选择系统',exact:true})).toHaveValue(system.id);
 await expect(page.getByRole('alert')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'管理模块',exact:true})).toBeEnabled();
});

test('saved readonly starter can be selected without replacing the full core or original cases',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'只读起步集合验证',environment:'测试',targetUrl:'https://example.com/starter'}})).json();const module=await(await request.post(base+'/api/system-module-regression/modules/import',{data:{systemId:system.id,name:'起步模块',fileName:'cases.csv',bytesBase64:pack('完整原始预期').toString('base64')}})).json();await request.post(base+'/api/system-module-regression/modules/'+module.id+'/core',{data:{versionId:module.versions[0].id,caseIds:[]}});
 await page.goto(base+'/?page=dify-regression&system='+system.id);await page.getByRole('button',{name:'查看用例',exact:true}).click();await page.getByRole('checkbox',{name:'全选当前用例',exact:true}).check();await page.getByRole('button',{name:'保存为最小回归',exact:true}).click();await page.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('combobox',{name:'执行范围',exact:true})).toHaveValue('starter');await expect(page.getByRole('columnheader',{name:'最小 / 全部',exact:true})).toBeVisible();
 const saved=await(await request.get(base+'/api/system-module-regression/modules/'+module.id)).json();expect(saved.module.coreCaseIds).toEqual([]);expect(saved.module.starterCaseIds).toEqual(['one']);expect(saved.cases[0].expected).toBe('完整原始预期');await page.reload();await expect(page.getByRole('combobox',{name:'执行范围',exact:true})).toHaveValue('starter');
});

test('minimum view uses only matching account, version and scope results; old full failures remain visible in full scope',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'最小结果隔离',environment:'测试',targetUrl:'https://example.com/scope-results'}})).json();const module=await(await request.post(base+'/api/system-module-regression/modules/import',{data:{systemId:system.id,name:'范围隔离模块',fileName:'cases.csv',bytesBase64:pack('完整原始预期').toString('base64')}})).json();await request.post(base+'/api/system-module-regression/modules/'+module.id+'/core',{data:{versionId:module.versions[0].id,scope:'starter',caseIds:['one']}});
 const state=await(await request.get(base+'/api/system-module-regression')).json();const batch=(scope:string,outcome:string,caseIds=['one'])=>({id:randomUUID(),requestId:randomUUID(),systemId:system.id,systemName:system.name,targetUrl:system.targetUrl,profileId:system.profileId,environment:'测试',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),phase:'completed',scope,entries:[{moduleId:module.id,moduleName:module.name,versionId:module.versions[0].id,version:1,digest:'fixture',caseCount:1,selectedCaseIds:caseIds,jobId:'job'}],jobs:[{id:'job',phase:'completed',outcome,selectedCaseIds:caseIds,results:[{caseId:'one',status:outcome}],difyRuns:[]}],counts:{passed:0,failed:0,blocked:0,error:0,not_executed:0,outside:0}});
 state.batches=[batch('all','blocked'),batch('starter','failed',['other-id']),batch('starter','passed')];await page.route('**/api/system-module-regression',route=>route.fulfill({json:state}));await page.goto(base+'/?page=dify-regression&system='+system.id);await expect(page.getByRole('combobox',{name:'执行范围',exact:true})).toHaveValue('starter');const row=page.getByRole('region',{name:'固定模块',exact:true}).getByRole('row').filter({hasText:'范围隔离模块'});await expect(row).toContainText('1 通过');await expect(row).not.toContainText('阻塞');await page.getByRole('combobox',{name:'执行范围',exact:true}).selectOption('all');await expect(row).toContainText('阻塞');
});

test('failed and blocked rows link to their own screenshot and preserve the preflight evidence explanation',async({page,request})=>{
 const system=await(await request.post(base+'/api/system-module-regression/systems',{data:{name:'本轮截图验证',environment:'测试',targetUrl:'https://example.com/evidence'}})).json();
 const module=await(await request.post(base+'/api/system-module-regression/modules/import',{data:{systemId:system.id,name:'截图模块',fileName:'cases.csv',bytesBase64:pack('原预期不改变').toString('base64')}})).json();
 const state=await(await request.get(base+'/api/system-module-regression')).json(),jobId=randomUUID(),batchId=randomUUID();
 const results=[{caseId:'blocked',title:'后台入口阻塞',expected:'原预期不改变',status:'blocked',detail:'当前只有员工页面。',evidence:'a'.repeat(64)+'.png',evidenceOrigin:'preflight',evidenceNote:'本轮前置阻塞现场；后台业务断言未执行。'},{caseId:'failed',title:'数量上界失败',expected:'原预期不改变',status:'failed',detail:'输入9999后实际为999。',evidence:'b'.repeat(64)+'.png',evidenceOrigin:'document-run'}];
 state.batches=[{id:batchId,systemId:system.id,systemName:system.name,targetUrl:system.targetUrl,profileId:system.profileId,environment:'测试',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),phase:'completed',scope:'custom',entries:[{moduleId:module.id,moduleName:module.name,versionId:module.versions[0].id,version:1,digest:'fixture',caseCount:2,selectedCaseIds:['blocked','failed'],jobId}],jobs:[{id:jobId,moduleName:module.name,phase:'completed',outcome:'failed',selectedCaseIds:['blocked','failed'],results,difyRuns:[]}],counts:{passed:0,failed:1,blocked:1,error:0,not_executed:0,outside:0}}];
 await page.route('**/api/system-module-regression',route=>route.fulfill({json:state}));
 await page.route('**/api/dify-web-modules/jobs/*/evidence/*',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
 await page.goto(base+'/?page=dify-regression&system='+system.id+'&batch='+batchId);
 await expect(page.getByRole('combobox',{name:'选择回归批次',exact:true})).toContainText('2 条');
 await expect(page.getByRole('region',{name:'本轮回归结果',exact:true}).getByRole('row').filter({hasText:'截图模块'})).toContainText('1 失败 · 1 阻塞');
 await page.getByRole('button',{name:'查看结果',exact:true}).click();
 for(const result of results)await expect(page.getByRole('link',{name:result.caseId+' 的本轮截图',exact:true})).toHaveAttribute('href',`/api/dify-web-modules/jobs/${jobId}/evidence/${result.evidence}`);
 await page.getByRole('row').filter({hasText:'后台入口阻塞'}).getByRole('button',{name:'详情',exact:true}).click();
 await expect(page.getByText('本轮前置阻塞现场；后台业务断言未执行。',{exact:true})).toBeVisible();
 await expect(page.getByRole('img',{name:'后台入口阻塞 的本轮截图',exact:true})).toBeVisible();
});
