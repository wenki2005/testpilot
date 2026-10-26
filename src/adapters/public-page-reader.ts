import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const maxResponseBytes = 2 * 1024 * 1024;
const maxTextLength = 30_000;

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    if (a === undefined || b === undefined || c === undefined) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    const value = address.toLowerCase();
    // Limit IPv6 to global-unicast space; reject loopback, mapped, ULA, link-local, multicast, and documentation ranges.
    return /^[23][0-9a-f]{0,3}:/u.test(value) && !value.startsWith("2001:db8:");
  }
  return false;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number }> {
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error("出于安全原因，只能读取解析到公网 IP 的网页地址。");
  return addresses[0]!;
}

function getOnce(url: URL, address: { address: string; family: number }): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const requestImpl = url.protocol === "https:" ? httpsRequest : url.protocol === "http:" ? httpRequest : undefined;
    if (!requestImpl) { reject(new Error("只支持 HTTP/HTTPS 网页地址。")); return; }
    const lookupPinned = (_hostname: string, optionsOrCallback: unknown, maybeCallback?: (error: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void) => {
      const options = typeof optionsOrCallback === "object" && optionsOrCallback !== null ? optionsOrCallback as { all?: boolean } : undefined;
      const callback = (typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback) as typeof maybeCallback;
      if (!callback) throw new Error("Node HTTP lookup callback missing.");
      if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
      else callback(null, address.address, address.family);
    };
    const request = requestImpl(url, { method: "GET", headers: { accept: "text/html,text/plain;q=0.9", "user-agent": "TestPilot-CaseGenerator/1.0" }, lookup: lookupPinned as never, timeout: 10_000 }, response => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      const contentType = String(response.headers["content-type"] ?? "");
      if (status >= 300 && status < 400 && location) { response.resume(); resolve({ status, location, contentType, body: Buffer.alloc(0) }); return; }
      if (status < 200 || status >= 300) { response.resume(); reject(new Error(`网站读取返回 HTTP ${status}。`)); return; }
      if (!/text\/html|text\/plain|application\/xhtml\+xml/iu.test(contentType)) { response.resume(); reject(new Error("网站响应不是可读取的 HTML 或纯文本。")); return; }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxResponseBytes) { response.resume(); reject(new Error("网页超过 2 MB 读取上限。")); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxResponseBytes) { request.destroy(new Error("网页超过 2 MB 读取上限。")); return; } chunks.push(chunk); });
      response.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("读取网页超时（10 秒）。")));
    request.on("error", reject);
    request.end();
  });
}

function htmlToText(input: string): string {
  const text = input.replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ").replace(/&nbsp;|&#160;/giu, " ").replace(/&amp;/giu, "&").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">")
    .replace(/&quot;|&#34;/giu, '"').replace(/&#39;|&apos;/giu, "'").replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/[ \t\f\v]+/gu, " ").replace(/\n\s*/gu, "\n").trim();
  if (text.length > maxTextLength) throw new Error(`网页可读文字为 ${text.length} 字符，超过 ${maxTextLength} 字上限；请缩小网页范围，系统不会静默截断。`);
  return text;
}

/** Read only a small public page. No cookies, browser profile, or user credentials are sent. */
export async function readPublicWebsiteText(rawUrl: string): Promise<string> {
  let current: URL;
  try { current = new URL(rawUrl); } catch { throw new Error("网站地址格式无效。"); }
  if (!["http:", "https:"].includes(current.protocol) || current.username || current.password) throw new Error("只支持不带账号密码的 HTTP/HTTPS 公网页面。");
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const address = await resolvePublicAddress(current.hostname);
    const response = await getOnce(current, address);
    if (response.location) {
      if (redirects === 3) throw new Error("网站重定向次数超过上限。");
      const next = new URL(response.location, current);
      if (current.protocol === "https:" && next.protocol !== "https:") throw new Error("网站尝试从 HTTPS 降级到非加密地址，已停止读取。");
      if (!["http:", "https:"].includes(next.protocol) || next.username || next.password) throw new Error("网站重定向地址无效。");
      current = next; continue;
    }
    const text = /text\/plain/iu.test(response.contentType) ? response.body.toString("utf8") : htmlToText(response.body.toString("utf8"));
    if (text.length > maxTextLength) throw new Error(`网页可读文字为 ${text.length} 字符，超过 ${maxTextLength} 字上限；请缩小网页范围，系统不会静默截断。`);
    if (!text) throw new Error("网页没有可提取的文字；如果页面需要登录或由 JavaScript 渲染，请粘贴页面文字或上传资料。");
    return text;
  }
  throw new Error("无法读取网页。");
}
