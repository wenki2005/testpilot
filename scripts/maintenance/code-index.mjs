#!/usr/bin/env node
/** Source navigation only. Does not start services, run tests, or read runtime data.
 * npm run code:index                 regenerate file/directory indexes
 * npm run code:find -- "审批"         locate a feature, symbol, old filename or case ID
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const slash=p=>p.replaceAll('\\','/');
const scan=directory=>fs.readdirSync(directory,{withFileTypes:true}).filter(e=>!e.isSymbolicLink()).flatMap(e=>e.isDirectory()?scan(path.join(directory,e.name)):e.isFile()?[path.join(directory,e.name)]:[]);
const category=p=>p.startsWith('web/src/app/')?'工作台与侧栏':p.includes('/features/')?({execution:'执行测试', 'case-scripts':'用例与脚本','run-reports':'运行报告',settings:'系统设置','case-assistance':'用例辅助整理','document-tests':'网页测试','api-tests':'接口测试',database:'数据库工具','source-tests':'源码测试','case-generation':'用例生成','regression-library':'回归用例库'}[p.split('/features/')[1].split('/')[0]]??'页面功能'):p.includes('/regression/')?'申样回归执行':p.includes('/reports/')?'运行报告':p.includes('/database/')?'数据库':p.includes('/source-tests/')?'源码测试':p.includes('/integrations/dify/')?'工作流连接':p.includes('/browser/')?'浏览器执行':p.includes('/ai/')?'模型适配':p.includes('/documents/')||p.includes('/document-')?'网页测试':p.includes('/http/')?'HTTP 接口':p.startsWith('scripts/')?'开发维护工具':p.startsWith('src/domain/')?'规则与数据契约':p.startsWith('src/application/')?'应用流程':p.startsWith('src/server/')?'服务启动与路由装配':'公共基础';
const specific={
 'execution-page':'执行测试主页面：范围、模块、批次和执行结果',
 'selected-case-results':'所选范围的逐条结果展示',
 'latest-case-results':'按版本读取逐条最新结果',
 'core-chain-selector':'核心链路选择及启动入口',
 'core-chain-results':'核心链路按顺序展示步骤结果',
 'case-script-editor':'用例和脚本编辑、前置关系、保存及版本',
 'case-editor-diff':'用例与脚本修改对比',
 'case-editor-columns':'用例和脚本之间的列宽拖动',
 'case-editor-ai-guide':'AI 接入说明；维护接口仍待完成',
 'run-reports':'运行报告列表、筛选、详情、名称备注和重要标记',
 'report-export':'Excel、XMind 报告导出及截图装配',
 'report-template':'部门申样报告的表格模板',
 'module-regression-service':'系统、模块、用例编辑、前置校验和批次调度',
 'module-execution-service':'模块版本、执行任务、步骤准备和结果汇总',
 'execution-manifest-store':'固定执行清单与派发、汇总协议',
 'core-chain-store':'核心链路任务调度、恢复、结果与截图存储',
 'core-chain-browser':'审批、库存、锁单、订单、物流链路浏览器核验',
 'core-chain-definitions':'四条核心链路及步骤顺序、原始用例引用',
 'regression-routes':'执行测试、用例编辑、核心链路及脚本下载 HTTP 接口',
 'run-report-routes':'报告列表、详情和报告元数据修改 HTTP 接口',
 'run-report-store':'报告聚合、名称、备注、重要标记和并发版本',
 'submit-application':'真实提交申样申请、唯一标记及提交后核验',
 'submission-receipts':'提交、撤销等操作凭证与重复执行保护',
 'approval-order-readback':'审批、锁单和订单同单证据核验',
 'business-readback':'业务链路证据归类、关联及核验',
 'regression-readback':'测试数据库连接、申请商品与订单字段读回',
 'approval-templates':'企微/OA 审批模板、仓库及下游配置基线核验',
 'order-detail-presentation':'订单详情字段、状态、物流展示核验，关联原85号用例',
 'order-creation-readback':'下单结果与申请、订单引用关联核验',
 'admin-order-records':'管理订单数据读回及关联',
 'my-orders':'本人订单查询和归属核验',
 'welfare-orders':'福利用途订单场景',
 'applicant-identity':'申请人身份与账号范围',
 'application-list':'申请记录列表和筛选',
 'application-detail':'申请明细及审批详情场景',
 'book-search':'图书编码、商品查询与图书字段',
 'invalid-books':'无效图书和查询异常场景',
 'sample-book-rows':'多行图书、数量、金额和删除行场景',
 'field-validation':'表单字段有效性校验',
 'client-validation':'前端拦截、按钮与字段校验',
 'form-baseline':'申样表单初始状态与配置基线',
 'connected-systems':'上游调用、通知与下游系统关联核验',
 'batch-notifier':'批次通知、通知重试和失败信息',
 'export-policy':'导出材料中的凭据与敏感字段检查',
 'script-package':'逐模块脚本包组装',
 'module-browser':'模块执行与浏览器、数据库、授权写入的装配',
 'scenario-planner':'只读业务场景的步骤规划与独立性判定',
 'case-baseline-store':'原始用例基线、辅助整理版本、审核与历史',
 'workflow-client':'Dify 工作流请求、响应和连接错误处理',
 'http-server':'本地 HTTP 服务启动、依赖装配和路由挂载',
 'server-state':'服务运行状态与依赖类型',
 'runtime':'本地测试运行时及通用执行辅助',
 'local-sample':'本地演示接口与样例响应',
 'project-selection':'侧栏项目选择事件与页面同步',
 'workbench':'工作台侧栏、页面装配与导航',
 'routes':'网页 page 参数和路由类型',
 'model-settings':'模型配置的读取与保存',
 'mysql-browser':'MySQL 结构、表和数据查询',
 'sqlite-migration-adapter':'SQLite 迁移场景执行',
 'sqlite-migration-worker':'SQLite 隔离执行子进程',
 'export-project-resources':'只读导出当前用例、脚本、前置和核心链路',
 'package-windows-demo':'Windows 演示包构建、允许清单及摘要',
 'start-integrated-workspaces':'已有工作区的启动与进程复用',
 'stop-integrated-workspaces':'校验实例身份及活动任务后停止服务',
 'serve-integrated-entry':'4325 入口路由转发与工作区隔离',
 'code-index':'生成代码导航及按功能、旧名称、用例编号定位代码',
};
function purpose(file){const stem=path.basename(file).replace(/\.(?:tsx?|mjs|json|css)$/,'');const detail=specific[stem]??stem.replaceAll('-',' ');return file.endsWith('.css')?detail+'（页面样式）':detail;}
const roots=['src','web/src','scripts','tests'];
const files=roots.flatMap(d=>scan(path.join(root,d))).filter(f=>/\.(ts|tsx|mjs|css|json)$/.test(f));
const moveFile=path.join(root,'docs/collaboration/source-layout-moves.json');
const moved=fs.existsSync(moveFile)?JSON.parse(fs.readFileSync(moveFile,'utf8')).moves:[];
const entries=files.map(full=>{const file=slash(path.relative(root,full)),text=fs.readFileSync(full,'utf8'),symbols=[];if(/\.(ts|tsx|mjs)$/.test(full)){
 const tree=ts.createSourceFile(full,text,ts.ScriptTarget.Latest,true,full.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(node,owner=''){
  if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node))&&node.name){const name=node.name.getText(tree),line=tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1;symbols.push({name,line,kind:ts.SyntaxKind[node.kind]});if(ts.isClassDeclaration(node))owner=name;}
  else if((ts.isMethodDeclaration(node)||ts.isGetAccessor(node)||ts.isSetAccessor(node))&&node.name)symbols.push({name:(owner?owner+'.':'')+node.name.getText(tree),line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,kind:'method'});
  else if(ts.isVariableStatement(node)&&node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))for(const d of node.declarationList.declarations)symbols.push({name:d.name.getText(tree),line:tree.getLineAndCharacterOfPosition(d.getStart(tree)).line+1,kind:'exported value'});
  ts.forEachChild(node,n=>visit(n,owner));
 }
 visit(tree);
}return {file,category:category(file),purpose:purpose(file),lines:text.split('\n').length,previousPaths:moved.filter(m=>m.to===file).map(m=>m.from),symbols};}).sort((a,b)=>a.file.localeCompare(b.file,'en'));

const args=process.argv.slice(2);
if(args[0]==='--write'){
 const index={schema:1,note:'Generated from source only; no runtime records or credentials.',files:entries};
 fs.writeFileSync(path.join(root,'docs/code-index.json'),JSON.stringify(index,null,2)+'\n');
 const dirs=new Set();for(const e of entries){let dir=path.posix.dirname(e.file);while(dir!=='.'&&roots.some(r=>dir===r||dir.startsWith(r+'/'))){dirs.add(dir);dir=path.posix.dirname(dir);}}
 const guideDirs=new Set(['src','src/adapters/regression','src/adapters/database','src/adapters/documents','src/adapters/api','src/adapters/source-tests','src/application','web/src','tests',...[...dirs].filter(d=>/^web\/src\/features\/[^/]+$/.test(d))]);
 let pages=0,removed=0;
 for(const dir of dirs){const filename=path.join(root,dir,'README.md');
  if(!guideDirs.has(dir)){if(fs.existsSync(filename)&&!fs.lstatSync(filename).isSymbolicLink()&&fs.readFileSync(filename,'utf8').startsWith('<!-- generated-code-index -->')){fs.unlinkSync(filename);removed++;}continue;}
  if(fs.existsSync(filename)&&!fs.readFileSync(filename,'utf8').includes('<!-- generated-code-index -->'))continue;
  const recursive=!['src','web/src','tests'].includes(dir);
  const own=entries.filter(e=>recursive?e.file.startsWith(dir+'/'):path.posix.dirname(e.file)===dir),children=[...dirs].filter(d=>path.posix.dirname(d)===dir).sort();
  const lines=['<!-- generated-code-index -->','# '+dir,'',category(dir+'/index.ts')+'。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。',''];
  if(children.length)lines.push('## 子目录','',...children.map(d=>'- ['+path.posix.basename(d)+']('+encodeURI(path.posix.basename(d))+(guideDirs.has(d)?'/README.md':'/')+')'),'');
  if(own.length){lines.push('## 文件职责','','| 文件 | 用途 | 主要入口 |','| --- | --- | --- |');for(const e of own){const relative=path.posix.relative(dir,e.file);lines.push('| ['+relative+']('+encodeURI(relative)+') | '+e.purpose.replaceAll('|','/')+' | '+e.symbols.slice(0,3).map(s=>'`'+s.name+'`').join('、')+' |');}lines.push('');}
  fs.writeFileSync(filename,lines.join('\n'));pages++;
 }
 console.log(JSON.stringify({files:entries.length,symbols:entries.reduce((n,e)=>n+e.symbols.length,0),directoryGuides:pages,removedGeneratedGuides:removed,index:'docs/code-index.json'}));
}else{
 const query=args.filter(v=>v!=='--find').join(' ').trim();
 if(!query){console.log('按功能查找：npm run code:find -- "审批"\n按旧文件名：npm run code:find -- "dify-order85-presentation"\n按用例编号：npm run code:find -- xmind-85\n完整入口：代码导航.md');process.exit(0);}
 const needle=query.toLowerCase(),rows=[];
 for(const e of entries){if(e.file==='scripts/maintenance/code-index.mjs'&&!/code-index|代码索引/.test(needle))continue;const metadata=[e.file,e.category,e.purpose,...e.previousPaths,...e.symbols.map(s=>s.name)].join(' ').toLowerCase();const caseNeedle=/^xmind-\d+$/.test(needle)?'原'+needle.slice(6)+'号用例':undefined;let score=metadata.includes(needle)||caseNeedle&&metadata.includes(caseNeedle)?10:0;let hit=e.symbols.find(s=>s.name.toLowerCase().includes(needle));
  if(!score){const text=fs.readFileSync(path.join(root,e.file),'utf8'),at=text.toLowerCase().indexOf(needle);if(at>=0){score=1;hit={line:text.slice(0,at).split('\n').length};}}
  if(score)rows.push({score,file:e.file,line:hit?.line??1,purpose:e.purpose,symbol:hit?.name??''});
 }
 rows.sort((a,b)=>b.score-a.score||a.file.localeCompare(b.file,'en'));
 for(const e of rows.slice(0,35))console.log(e.file+':'+e.line+'  '+e.purpose+(e.symbol?' ['+e.symbol+']':''));
 if(/^xmind-\d+$/i.test(query))for(const f of scan(path.join(root,'project-resources/department-sample')).filter(f=>path.basename(f).toLowerCase()===query.toLowerCase()+'.json'))console.log(slash(path.relative(root,f))+':1  用例资源快照（网页仍是有效版本来源）');
 console.log('共 '+rows.length+' 个代码文件匹配，最多显示35个。详细入口见“代码导航.md”。');
}
