import { useEffect, useRef, type ReactNode } from 'react';
/** 全站复用的模态框：<dialog> 原生焦点与遮罩，样式见 execution-page.css 的 .sm-modal。 */
export default function Modal({ title, onClose, children, error, className }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    error?: string;
    className?: string;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []);
    return <dialog className={'sm-modal' + (className ? ' ' + className : '')} ref={ref} onCancel={onClose}><header><h2>{title}</h2><button onClick={onClose}>关闭</button></header>{error && <p role="alert" className="sm-modal-error">{error}</p>}{children}</dialog>;
}
