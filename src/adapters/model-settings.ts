import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ModelSettings {
  baseUrl: string;
  model: string;
  apiKey?: string;
  browserCdpEndpoint?: string;
}

const dataDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(process.cwd(), "artifacts", "demo"));
const settingsFile = path.join(dataDir, "model-settings.json");
const defaultBaseUrl = "https://api.openai.com/v1";
const defaultModel = "gpt-4.1-mini";

function readSaved(): Partial<ModelSettings> {
  try {
    if (!existsSync(settingsFile)) return {};
    const value = JSON.parse(readFileSync(settingsFile, "utf8"));
    return {
      ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.model === "string" ? { model: value.model } : {}),
      ...(typeof value.apiKey === "string" && value.apiKey ? { apiKey: value.apiKey } : {}),
      ...(typeof value.browserCdpEndpoint === "string" && value.browserCdpEndpoint ? { browserCdpEndpoint: value.browserCdpEndpoint } : {}),
    };
  } catch {
    return {};
  }
}

export function resolveModelSettings(): ModelSettings {
  const saved = readSaved();
  const key = saved.apiKey || process.env.TESTPILOT_API_KEY || process.env.OPENAI_API_KEY;
  const browserCdpEndpoint = validateBrowserCdpEndpoint(saved.browserCdpEndpoint || process.env.TESTPILOT_BROWSER_CDP_ENDPOINT);
  return {
    // Persisted and environment values also reach the bearer-key sender, so
    // validate them on read rather than relying only on the settings form.
    baseUrl: validateBaseUrl(saved.baseUrl || process.env.TESTPILOT_BASE_URL || defaultBaseUrl),
    model: saved.model || process.env.TESTPILOT_MODEL || defaultModel,
    ...(key ? { apiKey: key } : {}),
    ...(browserCdpEndpoint ? { browserCdpEndpoint } : {}),
  };
}

export function readModelSettingsForUi() {
  const saved = readSaved();
  const resolved = resolveModelSettings();
  const keySource = saved.apiKey ? "settings" : process.env.TESTPILOT_API_KEY || process.env.OPENAI_API_KEY ? "environment" : "none";
  return {
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    keyConfigured: Boolean(resolved.apiKey),
    keySource,
    computerUseModel: process.env.TESTPILOT_COMPUTER_MODEL || resolved.model,
    computerUseNativeApi: resolved.baseUrl === defaultBaseUrl,
    browserCdpEndpoint: resolved.browserCdpEndpoint ?? "",
    browserCdpConfigured: Boolean(resolved.browserCdpEndpoint),
  } as const;
}

export function validateBrowserCdpEndpoint(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 200) throw new Error("Edge 调试地址无效。请填写本机地址，例如 http://127.0.0.1:9222。 ");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Edge 调试地址必须是本机 HTTP 地址，例如 http://127.0.0.1:9222。"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash) {
    throw new Error("为保护浏览器会话，Edge 调试地址只允许本机 HTTP 回环地址和显式端口，例如 http://127.0.0.1:9222。");
  }
  return url.toString().replace(/\/$/, "");
}

export function validateBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 500) throw new Error("API 地址无效。请填写兼容 OpenAI Chat Completions 的 API 根地址，例如 https://api.openai.com/v1。");
  const trimmed = value.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error("API 地址必须是完整的 HTTP 或 HTTPS 地址。"); }
  if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password || url.search || url.hash) {
    throw new Error("API 地址仅支持 HTTP/HTTPS 根地址，不能包含账号、密码、查询参数或片段。");
  }
  const loopbackHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !loopbackHttp) {
    throw new Error("为保护 API Key，远程模型服务必须使用 HTTPS；HTTP 仅允许本机回环地址用于本地开发。");
  }
  return url.toString().replace(/\/+$/, "");
}

export async function saveModelSettings(input: { baseUrl: unknown; model: unknown; apiKey?: unknown; clearApiKey?: unknown; browserCdpEndpoint?: unknown }): Promise<void> {
  const baseUrl = validateBaseUrl(input.baseUrl);
  if (typeof input.model !== "string" || !input.model.trim() || input.model.trim().length > 160) throw new Error("模型名称不能为空，且最多 160 个字符。");
  const saved = readSaved();
  const key = input.clearApiKey === true ? undefined : typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : saved.apiKey;
  const browserCdpEndpoint = input.browserCdpEndpoint === undefined ? saved.browserCdpEndpoint : validateBrowserCdpEndpoint(input.browserCdpEndpoint);
  if (typeof input.apiKey === "string" && input.apiKey.length > 4096) throw new Error("API Key 超过 4096 个字符。");
  const settings: ModelSettings = { baseUrl, model: input.model.trim(), ...(key ? { apiKey: key } : {}), ...(browserCdpEndpoint ? { browserCdpEndpoint } : {}) };
  await mkdir(dataDir, { recursive: true });
  const temporary = `${settingsFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(settings, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, settingsFile);
}

export async function testModelConnection(settings: ModelSettings): Promise<{ ok: true; model: string; toolCalling: true }> {
  if (!settings.apiKey) throw new Error("请先填写 API Key 并保存。");
  const baseUrl = validateBaseUrl(settings.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: "user", content: "Call the testpilot_connection_probe tool." }],
      tools: [{ type: "function", function: { name: "testpilot_connection_probe", description: "Connection check only; no external action.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } }],
      // Leave tool_choice unset. Some compatible providers (including DeepSeek V4
      // in thinking mode) reject forced/named tool_choice even though they support
      // tool calling with the default auto behavior.
      max_tokens: 256,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = body?.error?.message;
    if (typeof providerMessage === "string" && /thinking mode does not support this tool_choice/i.test(providerMessage)) {
      throw new Error("模型服务拒绝了强制工具调用参数。TestPilot 已改为自动选择工具调用；如果你仍看到此提示，请重启本地服务后再测试。DeepSeek V4 思考模式下不能使用具名或 required tool_choice。");
    }
    throw new Error(providerMessage || `API 返回 HTTP ${response.status}。请核对地址、模型和密钥。`);
  }
  const toolCalls = body?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(toolCalls) || !toolCalls.some((call: any) => call?.function?.name === "testpilot_connection_probe")) {
    throw new Error("API 可访问，但没有返回兼容的工具调用结果。TestPilot Agent 需要模型支持 tool calling。");
  }
  return { ok: true, model: settings.model, toolCalling: true };
}
