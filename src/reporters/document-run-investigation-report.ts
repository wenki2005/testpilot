import type { DocumentRunInvestigationRecord } from '../application/runs/document-run-investigation-service.js';

/** Render an advisory investigation without changing the saved record or the original run. */
export function renderDocumentRunInvestigationMarkdown(record: DocumentRunInvestigationRecord): string {
  const lines = [
    '# 运行调查报告', '',
    `- 运行：${inline(record.runId)}`,
    `- 调查记录：${inline(record.id)}`,
    `- 生成时间：${inline(record.createdAt)}`,
    '- 状态：初步判断，尚未确认根因',
    `- 覆盖：${record.coverage === 'complete' ? '完整' : '部分'}`,
    '- 本报告不改变原运行结论，也不代表已验证根因。', '',
    '## 用例假设与建议核查', '',
  ];
  const facts = new Map(record.facts.map(f => [f.factId, f]));
  for (const h of record.hypotheses) {
    lines.push(`### 用例 ${inline(h.caseId)} · ${inline(h.category)}`, '', inline(h.summary), '', '**建议核查：**', '', inline(h.nextAction), '', '**同用例事实引用：**', '');
    const refs = h.evidence.filter(ref => { const fact = facts.get(ref.factId); return fact?.caseId === h.caseId && fact.text.includes(ref.quote); });
    if (!refs.length) lines.push('没有可验证的同用例事实引用。', '');
    for (const ref of refs) {
      const fact = facts.get(ref.factId)!;
      lines.push(`- ${inline(fact.kind)}（${inline(fact.factId)}）`, '', fenced(ref.quote), '');
    }
  }
  lines.push('## 可用事实', '');
  for (const f of record.facts) {
    lines.push(`### 用例 ${inline(f.caseId)} · ${inline(f.kind)}`, '', fenced(f.text), '');
  }
  if (record.facts.some(f => f.kind === 'evidence-metadata')) lines.push('截图证据仅列出已保存的元数据；本报告未读取或检查图片像素。', '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function inline(value: string): string {
  // Escape Markdown syntax and HTML delimiters; user supplied text stays inert in prose.
  return value.replace(/[\\`*_{}[\]()#+.!|>~\-]/gu, '\\$&').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/\r?\n/gu, ' ');
}
function fenced(value: string): string {
  // A fence longer than every backtick run prevents embedded Markdown/HTML from closing it.
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/gu), m => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${value.replace(/\r/g, '')}\n${fence}`;
}
