import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { unzipSync } from "fflate";
import { confidenceFromExpectation, inferCaseCategory, type CaseCategory, type CaseConfidence } from "./document-test-types.js";

export interface ImportedDocument {
  format: "xmind" | "pdf" | "markdown" | "text";
  text: string;
  nodeCount?: number;
  testCases?: Array<{ title: string; source: string; modulePath?: string[]; expected: string; priority?: "P0" | "P1" | "P2" | "P3"; requirementRefs?: string[]; category?: CaseCategory; confidence?: CaseConfidence; coverageAreas?: CaseCategory[] }>;
}

const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_SOURCE_TEXT = 100_000;

export async function extractDocument(fileName: string, bytes: Uint8Array): Promise<ImportedDocument> {
  const ext = path.extname(fileName).toLowerCase();
  let result: ImportedDocument;
  if (ext === ".xmind") result = extractXmind(bytes);
  else if (ext === ".pdf") result = await extractPdf(bytes);
  else if (ext === ".md" || ext === ".markdown") result = { format: "markdown", text: stripMarkdownFrontMatter(decodeText(bytes)) };
  else if (ext === ".txt") result = { format: "text", text: decodeText(bytes) };
  else throw new Error("支持的文档格式为 PDF、XMind、Markdown 和 TXT。");
  const text = result.text.replace(/\u0000/g, "").trim();
  if (!text) throw new Error("没有从文档中提取到可读文字。");
  if (text.length > MAX_SOURCE_TEXT) throw new Error(`提取文本超过 ${MAX_SOURCE_TEXT} 字符上限，请拆分文档后重试。`);
  return { ...result, text };
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function stripMarkdownFrontMatter(text: string): string {
  return text.replace(/^\uFEFF?\s*---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
}

function extractXmind(bytes: Uint8Array): ImportedDocument {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); }
  catch { throw new Error("XMind 文件不是可读取的 ZIP/XMind 文档。"); }
  const names = Object.keys(entries);
  if (names.length > MAX_ARCHIVE_ENTRIES) throw new Error("XMind 文件包含过多条目。");
  const content = entries["content.json"];
  if (!content) throw new Error("当前仅支持包含 content.json 的 XMind 文件（XMind 8/旧版 XML 格式暂不支持）。");
  let sheets: unknown;
  try { sheets = JSON.parse(decodeText(content)); }
  catch { throw new Error("XMind content.json 无法解析。"); }
  if (!Array.isArray(sheets)) throw new Error("XMind 工作表结构无效。");
  const lines: string[] = [];
  const testCases: NonNullable<ImportedDocument["testCases"]> = [];
  let nodeCount = 0;
  const visit = (node: any, depth: number, ancestors: string[]): void => {
    if (!node || typeof node !== "object" || depth > 64 || nodeCount >= 20_000) return;
    nodeCount += 1;
    const title = typeof node.title === "string" ? node.title.trim() : "";
    const note = typeof node.notes?.plain?.content === "string" ? node.notes.plain.content.trim() : "";
    const pathParts = title ? [...ancestors, title] : ancestors;
    if (title) lines.push(`${"  ".repeat(Math.min(depth, 32))}- ${title}`);
    if (note) lines.push(`${"  ".repeat(Math.min(depth + 1, 32))}注释：${note}`);
    const children = [...(node.children?.attached ?? []), ...(node.children?.detached ?? [])];
    if (title && children.length === 0 && pathParts.length > 1) {
      const priorityMatch = title.match(/\bP([0-3])\b/i);
      const clean = title.replace(/^[✅❌⚠️🔄\s]+/u, "").replace(/\s+P[0-3]\s*$/i, "").trim();
      const ambiguous = /待澄清|待确认|需确认|待补充/.test(title);
      const behavior = clean.replace(/^(?:待澄清|待确认|需确认|待补充)\s*/u, "").trim();
      const parent = ancestors.at(-1) ?? "业务行为";
      testCases.push({
        title: `${parent} — ${behavior}`.slice(0, 160),
        source: pathParts.join(" › ").slice(0, 500),
        modulePath: pathParts.slice(0, -1).slice(0, 8),
        expected: ambiguous ? `[需澄清] ${behavior}`.slice(0, 300) : behavior.slice(0, 300),
        priority: priorityMatch ? `P${priorityMatch[1]}` as "P0" | "P1" | "P2" | "P3" : "P2",
        requirementRefs: [pathParts.join(" › ").slice(0, 500)],
        category: inferCaseCategory(pathParts.join(" ")),
        confidence: ambiguous ? "low" : confidenceFromExpectation(behavior),
        coverageAreas: [inferCaseCategory(pathParts.join(" "))],
      });
    }
    for (const child of children) visit(child, depth + 1, pathParts);
  };
  for (const sheet of sheets as any[]) {
    if (typeof sheet.title === "string") lines.push(`# ${sheet.title}`);
    visit(sheet.rootTopic, 0, []);
  }
  if (nodeCount >= 20_000) throw new Error("XMind 节点数达到 20000 安全上限；请拆分文件后重试，系统不会忽略后续节点。");
  return { format: "xmind", text: lines.join("\n"), nodeCount, testCases };
}

async function extractPdf(bytes: Uint8Array): Promise<ImportedDocument> {
  try {
    // pdf.js transfers/detaches the supplied ArrayBuffer while loading. A Node
    // Buffer may be a view into a pooled/slab ArrayBuffer; copy it to a standalone
    // Uint8Array first so PDF uploads work the same as files read directly.
    const pdfData = new Uint8Array(bytes);
    const task = getDocument({ data: pdfData, useSystemFonts: true } as Parameters<typeof getDocument>[0]);
    const pdf = await task.promise;
    const pages: string[] = [];
    let total = 0;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const text = content.items.map((item: any) => typeof item.str === "string" ? item.str : "").filter(Boolean).join(" ");
      pages.push(`## 第 ${pageNo} 页\n${text}`);
      total += text.length;
      if (total > MAX_SOURCE_TEXT) throw new Error(`PDF 提取文本超过 ${MAX_SOURCE_TEXT} 字符上限，请拆分文档后重试。`);
    }
    await task.destroy();
    return { format: "pdf", text: pages.join("\n\n") };
  } catch (error) {
    if (error instanceof Error && error.message.includes("上限")) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF 文本提取失败：${reason.slice(0, 300)}。若文件是扫描版 PDF，则当前版本暂不支持 OCR。`);
  }
}
