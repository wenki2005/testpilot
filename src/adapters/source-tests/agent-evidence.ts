import type { AgentMessage } from '@earendil-works/pi-agent-core';

// Design reference: openai/codex 68b67f0, unified_exec/exec_command.rs:
// return exit status, timing and explicit omission metadata, keeping logs out
// of the conversation budget. This is a TS adaptation, not a Codex invocation.
export function boundedObservation(text: string, limit = 10000) {
  if (text.length <= limit) return { text, omittedCharacters: 0 };
  const head = Math.floor(limit / 2), tail = limit - head;
  return { text: text.slice(0, head) + '\n[... output omitted; use read_evidence ...]\n' + text.slice(-tail), omittedCharacters: text.length - limit };
}

/** Keep call/result pairs and message ordering intact. Old results remain
 * recoverable from their evidence IDs; recent failure feedback stays verbatim. */
export function compactSourceContext(messages: AgentMessage[], budget = 24000): AgentMessage[] {
  if (JSON.stringify(messages).length <= budget) return messages;
  const recent = messages.filter(m => m.role === 'toolResult').slice(-2);
  return messages.map(message => {
    if (message.role !== 'toolResult' || recent.includes(message)) return message;
    const text = message.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (text.length <= 1000) return message;
    // Tool envelopes put the recoverable evidence ID before the observation.
    return { ...message, content: [{ type: 'text' as const, text: boundedObservation(text, 1000).text }] };
  });
}

export function nodeFailurePreview(stdout: string) {
  return [...stdout.matchAll(/^\s*not ok \d+ - (.+)\r?$/gm)].map(m=>m[1]!.trim()).slice(0,12);
}

export function nodeTestSummary(stdout: string, exitCode: number | null) {
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm)].map(m => [m[1]!, Number(m[2])]));
  const status = exitCode === null ? 'blocked' : (counts.fail ?? 0) > 0 ? 'failed'
    : exitCode !== 0 || !counts.tests || (counts.cancelled ?? 0) > 0 || (counts.skipped ?? 0) > 0 || (counts.todo ?? 0) > 0 || counts.pass !== counts.tests ? 'blocked' : 'passed';
  return { status, counts } as { status: 'passed' | 'failed' | 'blocked'; counts: Record<string, number> };
}
