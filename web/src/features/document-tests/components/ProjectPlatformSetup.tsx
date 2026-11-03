import React, { useState } from 'react';
import { request } from '../api/client';
import type { Project } from '../types';
import { projectPlatformOptions, type ProjectPlatform } from '../project-platform';

export function ProjectPlatformPicker(props: { value: ProjectPlatform | ''; onChange(value: ProjectPlatform | ''): void }) {
  return <React.Fragment><fieldset className="doc-platform-picker">
    <legend>新项目的目标端类型 <span>必选</span></legend>
    <p>请按实际使用入口选择。系统会保存对应浏览器与视口配置，不会替你判断业务端类型；企微工作台宿主控制尚未接通。</p>
    <div className="doc-platform-options">{projectPlatformOptions.map(option => <label key={option.value}>
      <input type="radio" name="new-project-platform" value={option.value} checked={props.value === option.value} onChange={() => props.onChange(option.value)} />
      <span><strong>{option.label}</strong><small>{option.value === 'pc-web' ? '桌面网页入口与桌面视口' : option.value === 'mobile-web' ? '移动浏览器入口与窄屏视口' : '企微工作台类型标记；实际宿主控制尚未接通'}</small></span>
    </label>)}</div>
  </fieldset></React.Fragment>;
}

export function ProjectPlatformConfirmation(props: { project: Project; onSaved(project: Project): void; onError(message: string): void }) {
  const current = props.project.platform;
  const [value, setValue] = useState<ProjectPlatform | ''>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (current?.type !== 'unknown' && current?.status === 'confirmed') return null;
  const confirm = async () => {
    if (!value) return;
    setBusy(true); setMessage('');
    try {
      const updated = await request<Project>(`/api/document-projects/${encodeURIComponent(props.project.id)}/update`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: value }),
      });
      props.onSaved(updated);
      setMessage('端类型与执行模板已保存；项目进入待复核状态，审核后才可运行。');
      setValue('');
    } catch (error) { const detail = (error as Error).message; setMessage('保存失败，请重试。'); props.onError(detail); }
    finally { setBusy(false); }
  };
  return <section className="doc-platform-confirmation" aria-label="确认旧项目端类型">
    <div><strong>旧项目端类型待确认</strong><p>旧项目保留原入口与用例；请选择它实际运行的端类型后，系统才会套用执行模板并要求重新审核。</p></div>
    <label>项目端类型<select aria-label="确认现有项目端类型" value={value} disabled={busy} onChange={event => setValue(event.target.value as ProjectPlatform | '')}>
      <option value="">请选择实际端类型</option>{projectPlatformOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <button type="button" className="button-secondary" disabled={busy || !value} onClick={() => void confirm()}>{busy ? '保存中…' : '确认并保存模板'}</button>
    {message && <small role="status">{message}</small>}
  </section>;
}
