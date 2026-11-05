import { useEffect, useRef } from 'react';
const instruction = '阅读接入包文档，配置 TestPilot MCP。读取当前项目和指定用例，按要求修改，先展示对比，不执行测试。';
/** Connection guidance only. No simulated MCP status or downloadable fake server. */
export default function CaseEditorAiGuide({ open, systemId, onClose, onCopy }: {
    open: boolean;
    systemId: string;
    onClose: () => void;
    onCopy: (value: string) => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const el = dialog.current;
        if (open && !el?.open)
            el?.showModal();
        else if (!open && el?.open)
            el.close();
    }, [open]);
    return <dialog ref={dialog} className="ce-ai-dialog" aria-labelledby="ce-ai-title" onClose={onClose} onClick={e => {
            if (e.target !== e.currentTarget)
                return;
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
                onClose();
        }}>
  <header><h2 id="ce-ai-title">AI 接入说明</h2><button type="button" onClick={onClose}>关闭</button></header>
  <div className="ce-ai-content"><div className="ce-ai-connection"><strong>TestPilot MCP</strong><span>用例维护</span></div>
   <h3>连接</h3><ol><li>打开 TestPilot。</li><li>将接入包交给 AI 编辑器。</li><li>按文档配置并启用 MCP。</li></ol>
   <div className="ce-ai-prompt">{instruction}</div><button type="button" onClick={() => onCopy(instruction)}>复制指令</button>
   <details className="ce-ai-package"><summary>接入包内容</summary><pre>{'README.md         使用说明\nAGENT-GUIDE.md    接入指引\nserver/           服务入口说明\nconfig/           本机配置\nexamples/         使用示例'}</pre></details>
   <h3>使用示例</h3><div className="ce-ai-prompt">修改 xmind-84，增加订单号检查，先展示对比。</div>
  </div>
  <footer><span>保存为新版本，不执行测试</span><button type="button" disabled={!systemId} onClick={() => { location.href = (location.pathname.startsWith('/dify/') ? '/dify' : '') + '/api/system-module-regression/maintenance/package?systemId=' + encodeURIComponent(systemId); }}>下载接入包</button></footer>
 </dialog>;
}
