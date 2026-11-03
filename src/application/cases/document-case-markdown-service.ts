import type { BrowserCheck } from "../../domain/document-test-model.js";
import { createHash } from "node:crypto";
import { canonicalCasesJSON, parseCasesMarkdown } from "../../domain/document-case-markdown.js";
function canonicalCaseDigest(cases:BrowserCheck[]):string{return createHash("sha256").update(canonicalCasesJSON(cases)).digest("hex");}

export type MarkdownImportError = Error & { code?: string };
export interface MarkdownCaseImportPort {
  getCases(projectId: string): Promise<BrowserCheck[] | undefined>;
  /** Must compare digest and append revisions/save atomically. */
  importCasesIfDigest(projectId: string, digest: string, cases: BrowserCheck[]): Promise<boolean>;
}
export function createDocumentCaseMarkdownService(port: MarkdownCaseImportPort) {
  return {
  async preview(projectId: string, markdown: string) {
   const current=await port.getCases(projectId); if(!current) throw Object.assign(new Error("项目不存在。"),{code:"not-found"});
   const bundle=parseCasesMarkdown(markdown,projectId); const currentById=new Map(current.map(c=>[c.id,c]));
   const proposed=bundle.cases.map(c=>{const prior=currentById.get(c.id); const copy={...c}; if(prior?.caseGenerationTrace)copy.caseGenerationTrace=structuredClone(prior.caseGenerationTrace);else delete copy.caseGenerationTrace; if(prior?.explorationEvidence)copy.explorationEvidence=structuredClone(prior.explorationEvidence);else delete copy.explorationEvidence; return {...copy,lifecycleStatus:"draft" as const,selectedForRegression:false};});
   const merged = [...current.filter(c => !proposed.some(p => p.id === c.id)), ...proposed];
   if (merged.length > 200) throw new Error("导入后项目用例总数不能超过 200 条。");
   const allIds=new Set(merged.map(c=>c.id));for(const c of merged)for(const id of c.dependsOnCaseIds??[])if(!allIds.has(id))throw new Error(`用例 ${c.id} 依赖不存在的项目用例 ${id}。`);
   const graph=new Map(merged.map(c=>[c.id,c.dependsOnCaseIds??[]]));const visiting=new Set<string>(),done=new Set<string>();const visit=(id:string)=>{if(visiting.has(id))throw new Error(`用例依赖存在循环：${id}`);if(done.has(id))return;visiting.add(id);for(const d of graph.get(id)??[])visit(d);visiting.delete(id);done.add(id)};for(const id of allIds)visit(id);
   return {digest:canonicalCaseDigest(current),changes:proposed.map(c=>({id:c.id,kind:currentById.has(c.id)?"update":"add",title:c.title})),cases:proposed};
  },
  async import(projectId: string, markdown: string, expectedDigest: string) {
   if(!/^[0-9a-f]{64}$/u.test(expectedDigest)) throw Object.assign(new Error("缺少有效的 expectedDigest。"),{code:"invalid"});
   const preview=await this.preview(projectId,markdown);
   if(preview.digest!==expectedDigest) throw Object.assign(new Error("项目用例已变化，请重新预览导入。"),{code:"stale"});
   const current=await port.getCases(projectId); if(!current) throw Object.assign(new Error("项目不存在。"),{code:"not-found"});
   const incoming=new Map(preview.cases.map(c=>[c.id,c]));
   const merged=[...current.filter(c=>!incoming.has(c.id)),...preview.cases];
   if(!await port.importCasesIfDigest(projectId,expectedDigest,merged)) throw Object.assign(new Error("项目用例已变化，请重新预览导入。"),{code:"stale"});
   return {projectId,imported:preview.cases.length,changes:preview.changes};
  }
 };
}
