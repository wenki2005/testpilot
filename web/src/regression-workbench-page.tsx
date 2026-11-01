import { useState } from 'react';
import DifyModuleWorkbench from './dify-module-workbench';
import SystemModuleWorkbench from './system-module-workbench';
import DifyRegressionPage from './dify-regression-page';
import ModuleRegressionPage from './module-regression-page';
import './dify-regression.css';

export default function RegressionWorkbenchPage(){
  const [legacy,setLegacy]=useState<'drafts'|'api'|'web'|null>(null);
  return <div><SystemModuleWorkbench/><details className="dm-legacy"><summary>历史与高级功能</summary><div className="dm-legacy-controls"><button onClick={()=>setLegacy('web')}>历史单包测试记录</button><button onClick={()=>setLegacy('drafts')}>原有用例整理与人工记录</button><button onClick={()=>setLegacy('api')}>原有固定 API 模块与记录</button></div>{legacy==='web'&&<DifyModuleWorkbench/>}{legacy==='drafts'&&<DifyRegressionPage embedded/>}{legacy==='api'&&<ModuleRegressionPage embedded/>}</details></div>;
}
