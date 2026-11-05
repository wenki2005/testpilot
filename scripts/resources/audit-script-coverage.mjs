import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {readResourceDirectory}=await import(pathToFileURL(path.join(repo,'dist/adapters/regression/resources/resource-directory.js')).href);
const {scriptCoverage}=await import(pathToFileURL(path.join(repo,'dist/adapters/regression/resources/script-coverage.js')).href);
const report=scriptCoverage(readResourceDirectory(path.join(repo,'project-resources/department-sample')).resources.cases);
if(process.argv.includes('--write')){
 const cell=s=>String(s).replaceAll('|','／').replaceAll('\n',' ');
 const output=['# 脚本覆盖核查','','定义覆盖不等于业务执行通过。统计来自当前资源种子和精确来源绑定的执行器。运行条件仍按每次真实证据核对。','',`共${report.total}条，${report.missingStepFiles}份没有保存DSL步骤。全量执行方式：${Object.entries(report.counts).map(([k,v])=>k+' '+v).join('；')}。`,'','## 原57份空步骤文件','','| 编号 | 用例 | 执行方式 | 执行器 | 还需什么 |','| --- | --- | --- | --- | --- |',...report.rows.filter(c=>!c.savedSteps).map(c=>'| '+[c.id,c.title,c.label,c.handler||'—',c.nextAction].map(cell).join(' | ')+' |'),'','没有增加占位断言，也没有凭已有执行器把用例记为通过。代码维护入口：src/adapters/regression/resources/script-coverage.ts；专项代码在表内执行器对应的scenarios目录。',''];
 fs.writeFileSync(path.join(repo,'docs/planning/script-coverage.md'),output.join('\n'));
}
console.log(JSON.stringify({total:report.total,missingStepFiles:report.missingStepFiles,counts:report.counts,emptyFileCounts:report.rows.filter(c=>!c.savedSteps).reduce((m,c)=>(m[c.kind]=(m[c.kind]??0)+1,m),{})},null,2));
