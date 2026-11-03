import { createElement } from 'react';
import type { RunHandoffProgress } from '../types';

export function PrerequisiteHandoffNotice({ handoff }: { handoff?: RunHandoffProgress }) {
  if (!handoff || handoff.status === 'waiting-prerequisites') return null;
  const blocked = handoff.status === 'blocked';
  return createElement('section', { className: `doc-notice ${blocked ? 'error' : ''}`, role: 'status', 'data-testid': 'prerequisite-handoff' },
    createElement('strong', null, blocked ? '前置页面接管已阻断' : '前置页面观察'),
    blocked ? createElement('p', null, handoff.reason ?? '页面或运行上下文已丢失；目标用例未执行。') : createElement('div', null,
      handoff.analysis?.summary && createElement('p', null, handoff.analysis.summary),
      ...((handoff.analysis?.citations ?? []).map((citation, index) => createElement('blockquote', { key: `${handoff.evidence?.evidenceId ?? 'e'}-${index}` }, citation.quote))),
      handoff.evidence && createElement('small', null, `来源：${handoff.evidence.title || handoff.evidence.sourceUrl} · 仅分析可见文字，未检查图像像素。`),
      handoff.status === 'ready-to-continue' && createElement('small', null, '前置用例已完成；点击“继续运行”后只执行目标用例。')),
  );
}
