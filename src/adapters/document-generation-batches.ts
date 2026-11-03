export interface DocumentGenerationBatch {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** Lossless offsets refer to the original UTF-16 source, before prompt decoration. */
export function planDocumentGenerationBatches(source: string): DocumentGenerationBatch[] {
  if (!source.trim()) throw new Error("需求资料不能为空。");
  if (source.length > 100_000) throw new Error("需求资料超过 100000 字符；请按文档拆分，未截断或发送模型请求。");
  if (source.length <= 16_000) return [{ index: 1, start: 0, end: source.length, text: source }];
  const result: DocumentGenerationBatch[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + 14_000, source.length);
    if (end < source.length) {
      const segment = source.slice(start, end);
      // Prefer a section boundary, otherwise a complete paragraph or line.
      const heading = [...segment.matchAll(/\n#{1,3} /g)].at(-1)?.index ?? -1;
      const boundary = heading >= 7_000 ? heading : segment.lastIndexOf("\n\n") >= 7_000 ? segment.lastIndexOf("\n\n") : segment.lastIndexOf("\n");
      if (boundary >= 7_000) end = start + boundary + 1;
      // Do not split a Unicode surrogate pair.
      const before = source.charCodeAt(end - 1), after = source.charCodeAt(end);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
    }
    result.push({ index: result.length + 1, start, end, text: source.slice(start, end) });
    start = end;
  }
  // At most 12 cases per batch, within the workflow's 200-case limit.
  if (result.length > 16) throw new Error("需求分段超过 16 批；请按模块拆分，未发送模型请求。");
  return result;
}
