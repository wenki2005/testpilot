/** Small, conservative authoring helpers for UI assertions grounded in literal requirements. */

export type GroundedReadOnlyStep = { action: "assertExactVisible"; text: string };

/**
 * Extract literal page copy only when the requirement explicitly describes
 * static page copy. This intentionally does not turn transient toasts,
 * backend values, or arbitrary quoted examples into UI checks.
 */
export function draftExplicitStaticCopySubcheck(input: { title: string; expected: string }): GroundedReadOnlyStep[] | undefined {
  const source = `${input.title}\n${input.expected}`;
  const marker = /(?:页面提示文案|页面文案|静态提示文案|页面固定提示)/u;
  if (!marker.test(source)) return undefined;

  const escapedQuotes = /(?:页面提示文案|页面文案|静态提示文案|页面固定提示)(?:为|是|[:：]?\s*)[「“"]([^「」“”"]{2,160})[」”"]/gu;
  const copy = [...source.matchAll(escapedQuotes)]
    .map(match => match[1]?.trim())
    .find(value => value && value.length >= 2);
  return copy ? [{ action: "assertExactVisible", text: copy }] : undefined;
}
