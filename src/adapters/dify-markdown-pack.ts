import type {ImportedDocument} from './document-importer.js';
import type {BrowserCheck} from './document-test-workflow.js';
import {assertDifyExportSafe} from './dify-export-policy.js';

/** Explicit module-case Markdown, deliberately separate from global document import. */
export function parseDifyMarkdown(text:string):{document:ImportedDocument;manualSteps:Record<string,string[]>} {
  const blocks:Array<{id:string;title:string;lines:string[]}>=[];let current:typeof blocks[number]|undefined;let fenced=false;
  for(const line of text.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').split('\n')){
    if(/^```/.test(line.trim()))fenced=!fenced;
    const heading=!fenced&&line.match(/^##\s+([A-Za-z0-9][A-Za-z0-9_.:-]{0,79})\s*[|｜]\s*(.+)$/);
    if(heading){current={id:heading[1]!,title:heading[2]!.trim(),lines:[]};blocks.push(current);}else if(current)current.lines.push(line);
  }
  if(fenced)throw Error('Markdown 存在未闭合的代码块。');
  if(!blocks.length||blocks.length>200)throw Error('Markdown 需要 1—200 条用例，标题格式为：## 用例编号 | 标题。');
  const manualSteps:Record<string,string[]>={};
  const cases=blocks.map(block=>{
    const sections:Record<string,string[]>={};let section='meta';let inFence=false;
    for(const line of block.lines){if(/^```/.test(line.trim()))inFence=!inFence;const title=!inFence&&line.match(/^###\s+(.+)$/);if(title){section=title[1]!.trim();if(!['前置条件','操作步骤','步骤','固定步骤','预期结果'].includes(section))throw Error(`用例 ${block.id} 包含未知栏目：${section}`);if(sections[section])throw Error(`用例 ${block.id} 栏目重复。`);sections[section]=[];}else (sections[section]??=[]).push(line);}
    const meta=(sections.meta??[]).join('\n');
    const priorityText=meta.match(/^[-*]\s*优先级[：:]\s*(.+)$/m)?.[1]?.trim();
    if(priorityText&&!/^P[0-3]$/.test(priorityText))throw Error(`用例 ${block.id} 的优先级必须是 P0、P1、P2 或 P3。`);
    const priority=priorityText as BrowserCheck['priority']|undefined;
    const source=meta.match(/^[-*]\s*来源[：:]\s*(.+)$/m)?.[1]?.trim()??block.id;
    let expected=(sections['预期结果']??[]).join('\n').trim();
    if(/^```(?:text)?\n/.test(expected)&&/\n```$/.test(expected))expected=expected.replace(/^```(?:text)?\n/,'').replace(/\n```$/,'');
    if(!expected)throw Error(`用例 ${block.id} 缺少“预期结果”，不会自动编造。`);
    const instructions=(sections['操作步骤']??sections['步骤']??[]).map(l=>l.replace(/^\s*(?:[-*]|\d+[.、])\s*/, '').trim()).filter(Boolean);
    manualSteps[block.id]=instructions;
    let steps:unknown[]=[];const fixed=(sections['固定步骤']??[]).join('\n').trim();
    if(fixed){if(!/^```(?:json|testpilot-steps)\n[\s\S]*\n```$/.test(fixed))throw Error(`用例 ${block.id} 固定步骤格式无效，请使用导出的固定步骤块。`);try{steps=JSON.parse(fixed.replace(/^```[^\n]*\n/,'').replace(/\n```$/,''));if(!Array.isArray(steps))throw Error();}catch{throw Error(`用例 ${block.id} 的固定步骤无法读取。`);}}
    return {id:block.id,title:block.title,source,expected,steps,preconditions:(sections['前置条件']??[]).map(l=>l.replace(/^\s*[-*]\s*/,'').trim()).filter(Boolean),...(priority?{priority}:{})};
  });
  return {document:{format:'markdown',text,testCases:cases},manualSteps};
}

export function formatDifyMarkdown(name:string,cases:BrowserCheck[],manualSteps:Record<string,string[]>={}):string {
  assertDifyExportSafe({name,cases,manualSteps});
  const literal=(value:string)=>{if(/^```/m.test(value))throw Error('原始预期包含代码围栏，无法无损导出此模板；原用例未修改。');return '```text\n'+value+'\n```';};
  return ['# '+name,...cases.map(c=>`## ${c.id} | ${c.title}\n\n- 优先级：${c.priority}\n- 来源：${c.source}\n\n### 前置条件\n${c.preconditions.map(v=>'- '+v).join('\n')}\n\n### 操作步骤\n${(manualSteps[c.id]??[]).map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\n${c.steps.length?'### 固定步骤\n```testpilot-steps\n'+JSON.stringify(c.steps,null,2)+'\n```\n\n':''}### 预期结果\n${literal(c.expected)}\n`)].join('\n\n');
}
