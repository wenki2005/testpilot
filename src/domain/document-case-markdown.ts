import type { BrowserCheck } from "./document-test-model.js";
import { validateCases } from "./document-case-validation.js";

export type MarkdownCaseBundle = { format: "testpilot-cases"; version: 1; projectId: string; cases: BrowserCheck[] };
export function canonicalCasesJSON(cases:BrowserCheck[]):string {
  const stable = (value: any): any => Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value;
  return JSON.stringify(stable(cases));
}
export function exportCasesMarkdown(projectId: string, cases: BrowserCheck[]): string {
  const rows = cases.map(testCase =>
    `## ${testCase.title}\n\n- ID: \`${testCase.id}\`\n- 模块: ${testCase.modulePath?.join(" / ") || "未分类"}\n- 优先级: ${testCase.priority}\n- 依赖: ${testCase.dependsOnCaseIds?.join(", ") || "无"}\n`,
  );
  const bundle: MarkdownCaseBundle = { format: "testpilot-cases", version: 1, projectId, cases };
  return `<!-- TestPilot cases v1; JSON payload is the lossless source of truth. -->\n\n# TestPilot 用例资产\n\n${rows.join("\n")}\n\n<!-- 编辑 JSON 数据块；上方标题、模块和优先级仅供阅读。 -->\n\n\`\`\`json\n${JSON.stringify(bundle, null, 2)}\n\`\`\`\n`;
}
export function parseCasesMarkdown(markdown: unknown, projectId: string): MarkdownCaseBundle {
  if (typeof markdown !== "string" || markdown.length > 4_000_000) throw new Error("Markdown 内容无效或超过 4 MB。");
  const blocks = [...markdown.matchAll(/```json\s*([\s\S]*?)\s*```/giu)];
  const allFences = [...markdown.matchAll(/```/gu)];
  if (blocks.length !== 1 || allFences.length !== 2) throw new Error("Markdown 必须且只能包含一个 JSON 代码块，不能有其他围栏块。");
  let bundle: any;
  try { bundle = JSON.parse(blocks[0]![1]!); } catch { throw new Error("用例 JSON 格式错误。"); }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)
    || Object.keys(bundle).some(key => !["format", "version", "projectId", "cases"].includes(key))
    || bundle.format !== "testpilot-cases" || bundle.version !== 1 || bundle.projectId !== projectId || !Array.isArray(bundle.cases)) {
    throw new Error("用例资产 schema/version/projectId 无效，或包含未知顶层字段。");
  }
 // validateCases is the canonical DSL and BrowserCheck validator. Require its normalized output
 // to equal the payload so invalid or lossy input is never silently repaired.
 const validated = validateCases(bundle.cases);
 const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
 // Optional fields may be absent in older but valid BrowserCheck records. Compare every
 // supplied field against validator output, while allowing validator-owned defaults.
 for (let i = 0; i < bundle.cases.length; i++) {
   const raw = bundle.cases[i], normalized: any = validated[i];
   for (const key of Object.keys(raw)) {
     const allowedEmptyOptionalArray = Array.isArray(raw[key]) && raw[key].length === 0 && !(key in normalized) && ["modulePath", "dependsOnCaseIds", "tags"].includes(key);
     if (!allowedEmptyOptionalArray && (!(key in normalized) || JSON.stringify(stable(raw[key])) !== JSON.stringify(stable(normalized[key])))) throw new Error(`用例 ${raw.id} 字段 ${key} 无效或会被校验器裁剪。`);
   }
 }
 const ids = new Set(validated.map(testCase => testCase.id));
 for (const testCase of validated) for (const dependencyId of testCase.dependsOnCaseIds ?? []) if (dependencyId === testCase.id) throw new Error(`用例 ${testCase.id} 存在自依赖。`);
 const graph = new Map(validated.map(testCase => [testCase.id, testCase.dependsOnCaseIds ?? []]));
 const visiting = new Set<string>(), done = new Set<string>();
 const visit = (id: string) => { if (visiting.has(id)) throw new Error(`用例依赖存在循环：${id}`); if (done.has(id)) return; visiting.add(id); for (const dependencyId of graph.get(id) ?? []) if (graph.has(dependencyId)) visit(dependencyId); visiting.delete(id); done.add(id); };
 for (const id of ids) visit(id);
 return bundle as MarkdownCaseBundle;
}
