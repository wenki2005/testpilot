import { useState } from 'react';
import DifyModuleWorkbench from '../execution/module-preview/module-workbench';
import SystemModuleWorkbench from '../execution/execution-page';
import DifyRegressionPage from '../case-assistance/case-assistance-page';
import ModuleRegressionPage from '../document-tests/module-regression-page';
import '../case-assistance/case-assistance.css';
export default function RegressionWorkbenchPage() {
    const [legacy, setLegacy] = useState<'drafts' | 'api' | 'web'>('web');
    const url = new URL(location.href), isLegacy = url.searchParams.get('view') === 'legacy';
    if (!isLegacy)
        return <SystemModuleWorkbench />;
    url.searchParams.delete('view');
    return <div className="sm-workbench sm-legacy-page"><header className="sm-title"><h1>旧版记录</h1><a href={url.href}>返回回归工作台</a></header><label className="sm-legacy-choice">记录类型<select aria-label="旧版记录类型" value={legacy} onChange={e => setLegacy(e.target.value as typeof legacy)}><option value="web">历史单包测试记录</option><option value="drafts">原有用例整理与人工记录</option><option value="api">原有固定 API 模块与记录</option></select></label>{legacy === 'web' && <DifyModuleWorkbench />}{legacy === 'drafts' && <DifyRegressionPage embedded/>}{legacy === 'api' && <ModuleRegressionPage embedded/>}</div>;
}
