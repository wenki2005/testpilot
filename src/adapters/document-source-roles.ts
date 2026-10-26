import type { ImportedDocument } from "./document-importer.js";

export type DocumentInputRole = "auto" | "requirements" | "coverage-reference" | "held-out-benchmark";
export type ResolvedDocumentInputRole = Exclude<DocumentInputRole, "auto">;

export type DocumentInput = {
  fileName: string;
  requestedRole?: DocumentInputRole;
  document: ImportedDocument;
};

export type ResolvedDocumentSources = {
  requirementsText: string;
  benchmarkCases: NonNullable<ImportedDocument["testCases"]>;
  coverageReferences: Array<{ title: string; url: string; snippet: string }>;
  sourceRoles: Array<{ fileName: string; role: ResolvedDocumentInputRole }>;
};

/** Resolve each imported file's role once, then build disjoint generation and
 * post-generation comparison inputs. In particular, benchmark text never
 * appears in requirementsText or coverageReferences. */
export function resolveDocumentInputRoles(inputs: DocumentInput[]): ResolvedDocumentSources {
  if (!Array.isArray(inputs) || inputs.length > 5) throw new Error("一次最多处理 5 份需求/参考/基准资料。");
  const requirements: string[] = [];
  const benchmarkCases: NonNullable<ImportedDocument["testCases"]> = [];
  const coverageReferences: ResolvedDocumentSources["coverageReferences"] = [];
  const sourceRoles: ResolvedDocumentSources["sourceRoles"] = [];
  const seenFiles = new Set<string>();
  let referenceChars = 0;

  for (const input of inputs) {
    if (!input || typeof input.fileName !== "string" || !input.fileName.trim() || !input.document || typeof input.document.text !== "string") throw new Error("每份输入必须包含文件名与已解析资料。");
    const fileName = input.fileName.trim();
    if (seenFiles.has(fileName.toLocaleLowerCase())) throw new Error(`文件名重复：${fileName}。请为每份资料指定不同名称，避免来源追溯冲突。`);
    seenFiles.add(fileName.toLocaleLowerCase());
    const requestedRole = input.requestedRole ?? "auto";
    if (!["auto", "requirements", "coverage-reference", "held-out-benchmark"].includes(requestedRole)) throw new Error(`${fileName} 的资料角色无效。`);
    const extractedCases = input.document.testCases ?? [];
    const role: ResolvedDocumentInputRole = requestedRole === "auto"
      ? extractedCases.length ? "held-out-benchmark" : "requirements"
      : requestedRole;
    if (role === "requirements" && extractedCases.length) throw new Error(`${fileName} 被标记为需求资料，但解析到 ${extractedCases.length} 条测试用例。请将它标记为“留出基准”或“覆盖参考”，避免把基准泄漏到生成输入。`);
    sourceRoles.push({ fileName, role });

    if (role === "requirements") {
      requirements.push(`# 需求资料：${fileName}\n\n${input.document.text}`);
      continue;
    }
    if (role === "held-out-benchmark") {
      benchmarkCases.push(...extractedCases.map(item => {
        const source = `[基准 ${fileName}] ${item.source}`;
        return { ...item, source, requirementRefs: [source] };
      }));
      continue;
    }
    if (extractedCases.length) {
      coverageReferences.push(...extractedCases.map(item => ({
        title: item.title,
        url: `uploaded-coverage-reference:${encodeURIComponent(fileName)}`,
        snippet: `${item.source}\n参考预期：${item.expected}`,
      })));
    } else {
      if (input.document.text.length > 2_500) throw new Error(`${fileName} 的覆盖参考为 ${input.document.text.length} 字符；当前单份限制 2500 字，请拆分或标记为留出基准，系统不会静默截断。`);
      coverageReferences.push({
        title: fileName,
        url: `uploaded-coverage-reference:${encodeURIComponent(fileName)}`,
        snippet: input.document.text,
      });
    }
    if (role === "coverage-reference") referenceChars += coverageReferences.slice(-Math.max(extractedCases.length, 1)).reduce((sum, example) => sum + example.snippet.length, 0);
  }
  if (coverageReferences.length > 20 || referenceChars > 20_000) throw new Error(`覆盖参考合计 ${coverageReferences.length} 条、${referenceChars} 字符；当前限制为 20 条且 20000 字符，请缩小参考范围或标为留出基准。`);
  return { requirementsText: requirements.join("\n\n---\n\n"), benchmarkCases, coverageReferences, sourceRoles };
}
