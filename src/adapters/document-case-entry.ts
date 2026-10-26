const SENSITIVE_QUERY_KEY = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key|client[_-]?secret|authorization|password|passwd|secret|token)$/iu;

function hasSensitiveQueryKey(value: string): boolean {
  return value.split(/[?&;]/u).slice(1).some(pair => {
    const rawKey = pair.split("=", 1)[0] ?? "";
    let key = rawKey;
    try { key = decodeURIComponent(rawKey.replace(/\+/gu, " ")); } catch { /* malformed escapes are rejected by URL parsing below */ }
    return SENSITIVE_QUERY_KEY.test(key.trim());
  });
}

/** Accept a same-origin path only. Credentials and off-site navigation never belong in a test case. */
export function normalizeDocumentCaseEntryPath(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 500) throw new Error("用例页面入口路径必须是不超过 500 字的同源站内路径。");
  const entryPath = value.trim();
  if (!entryPath) return undefined;
  if (!entryPath.startsWith("/") || entryPath.startsWith("//") || entryPath.includes("\\") || /[\u0000-\u001f\u007f]/u.test(entryPath) || hasSensitiveQueryKey(entryPath)) {
    throw new Error("用例页面入口路径必须以 / 开头并留在当前网站；不要填外站地址或凭证参数。");
  }
  let parsed: URL;
  try { parsed = new URL(entryPath, "https://testpilot.invalid"); }
  catch { throw new Error("用例页面入口路径无效。"); }
  if (parsed.origin !== "https://testpilot.invalid" || parsed.username || parsed.password) throw new Error("用例页面入口路径必须留在当前网站。");
  return entryPath;
}

/** Resolve a case path while retaining the environment query from the versioned base URL. */
export function resolveDocumentCaseEntryUrl(baseUrl: string, entryPath?: string): string {
  const base = new URL(baseUrl);
  if (!entryPath) return base.href;
  const normalized = normalizeDocumentCaseEntryPath(entryPath);
  if (!normalized) return base.href;
  const target = new URL(normalized, base);
  if (target.origin !== base.origin) throw new Error("用例页面入口与本轮网站版本不在同一来源，已阻止导航。");
  const environmentQuery = new URLSearchParams(base.search);
  const entryQuery = new URLSearchParams(target.search);
  for (const key of new Set([...entryQuery.keys()])) {
    const entryValues = entryQuery.getAll(key);
    if (environmentQuery.has(key)) {
      const existing = environmentQuery.getAll(key);
      if (entryValues.some(value => !existing.includes(value))) throw new Error(`用例入口不能覆盖网站版本参数 ${key}。`);
    } else for (const value of entryValues) environmentQuery.append(key, value);
  }
  target.search = environmentQuery.toString();
  return target.href;
}
