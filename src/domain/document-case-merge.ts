import type { BrowserCheck } from "./document-test-model.js";

/** Merge model-authored cases into an existing suite without duplicate titles/expectations or silent truncation. */
export function mergeDocumentBrowserCases(existing: BrowserCheck[], generated: BrowserCheck[]): BrowserCheck[] {
  const seen = new Set<string>();
  const merged = [...existing, ...generated].filter(item => {
    const key = `${item.title.trim().toLocaleLowerCase()}\n${item.expected.trim().toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (merged.length > 200) throw new Error(`合并后有 ${merged.length} 条用例，项目上限 200；请分批建项目，未静默截断。`);
  return merged.map((item, index) => ({ ...item, caseOrigin: item.caseOrigin ?? "manual", id: `case-${index + 1}` }));
}
