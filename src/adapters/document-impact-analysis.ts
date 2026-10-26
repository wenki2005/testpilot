export type ImpactCase = {
  id: string;
  title: string;
  source?: string;
  entryPath?: string;
  modulePath?: string[];
  requirementRefs?: string[];
  expected?: string;
  preconditions?: string[];
  testData?: string[];
  steps?: Array<Record<string, unknown>>;
};

export type DocumentImpactSuggestion = {
  caseId: string;
  title: string;
  score: number;
  matchedTerms: string[];
  evidence: string[];
};

export type DocumentImpactScan = {
  suggestions: DocumentImpactSuggestion[];
  unmatchedTerms: string[];
  matchingMethod: "keyword-evidence";
};

const stopTerms = new Set([
  "新增", "调整", "修改", "更新", "优化", "支持", "改进", "修复", "本次", "迭代", "变更", "变化", "相关", "页面", "功能", "流程", "应用", "系统", "用户", "内容", "进行", "实现", "确认", "查看", "操作", "状态", "正常", "信息", "部分", "一个", "这个", "可以", "需要", "以及", "对于", "是否", "所有", "继续", "入口", "进行",
  "add", "added", "change", "changed", "update", "updated", "improve", "improved", "feature", "function", "support", "system", "application", "screen", "page", "flow", "user", "new", "the", "and", "for", "with",
]);

function noteTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const word of text.toLocaleLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9_-]{2,}/giu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      for (let length = 2; length <= Math.min(5, word.length); length++) {
        for (let start = 0; start + length <= word.length; start++) {
          const term = word.slice(start, start + length);
          if (!stopTerms.has(term)) terms.add(term);
        }
      }
    } else if (!stopTerms.has(word)) terms.add(word);
  }
  return [...terms].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function termWeight(term: string): number {
  if (/^[\p{Script=Han}]+$/u.test(term)) return term.length >= 4 ? 2.5 : term.length === 3 ? 1.6 : 0.9;
  return term.length >= 7 ? 2 : term.length >= 5 ? 1.5 : 1;
}

/**
 * Build reviewable, deterministic impact candidates from the change note and
 * saved case metadata. This is a keyword scan, never a claim of semantic
 * coverage; every recommendation carries the exact matching text field.
 */
export function analyzeDocumentCaseImpact(cases: ImpactCase[], changeNotes: string): DocumentImpactScan {
  const terms = noteTerms(changeNotes);
  const matchedTerms = new Set<string>();
  const suggestions = cases.map(item => {
    const fields: Array<{ label: string; text: string; weight: number }> = [
      ...(item.modulePath ?? []).map(value => ({ label: "业务模块", text: value, weight: 2.2 })),
      ...(item.requirementRefs ?? []).map(value => ({ label: "需求引用", text: value, weight: 2.1 })),
      ...(item.entryPath ? [{ label: "页面入口", text: item.entryPath, weight: 2.2 }] : []),
      { label: "用例标题", text: item.title, weight: 2 },
      ...(item.source ? [{ label: "用例来源", text: item.source, weight: 1.5 }] : []),
      ...(item.expected ? [{ label: "预期结果", text: item.expected, weight: 1.2 }] : []),
      ...(item.preconditions ?? []).map(value => ({ label: "前置条件", text: value, weight: 1.1 })),
      ...(item.testData ?? []).map(value => ({ label: "测试数据", text: value, weight: 1 })),
      ...(item.steps ?? []).flatMap((step, index) => Object.entries(step)
        .filter(([, value]) => typeof value === "string")
        .map(([, value]) => ({ label: `第 ${index + 1} 步`, text: value as string, weight: 1.1 }))),
    ];
    const evidence: string[] = [];
    const caseTerms = new Set<string>();
    for (const field of fields) {
      const normalized = field.text.toLocaleLowerCase();
      for (const term of terms) {
        if (!normalized.includes(term) || caseTerms.has(term)) continue;
        caseTerms.add(term);
        matchedTerms.add(term);
        evidence.push(`${field.label}包含“${term}”`);
      }
    }
    const score = [...caseTerms].reduce((sum, term) => sum + termWeight(term), 0);
    return { caseId: item.id, title: item.title, score, matchedTerms: [...caseTerms].sort((a, b) => b.length - a.length || a.localeCompare(b)), evidence };
  }).filter(item => item.score >= 1.5)
    .sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId));
  return {
    suggestions,
    unmatchedTerms: terms.filter(term => !matchedTerms.has(term)).slice(0, 30),
    matchingMethod: "keyword-evidence",
  };
}
