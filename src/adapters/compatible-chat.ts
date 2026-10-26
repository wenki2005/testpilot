import { resolveModelSettings } from "./model-settings.js";

export type ChatMessage = Record<string, any> & { role: string };

export function configuredChatModel() {
  const config = resolveModelSettings();
  if (!config.apiKey) throw new Error("请先在设置中配置模型 API Key。");
  return { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model };
}

/** OpenAI Chat Completions compatible request. Deliberately omits tool_choice,
 * which is rejected by DeepSeek V4 thinking mode for forced/named tool calls.
 */
export async function completeChat(messages: ChatMessage[], options: {
  tools?: unknown[];
  model?: string;
  responseFormat?: { type: "json_object" };
  thinking?: { type: "enabled" | "disabled" };
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<any> {
  const config = configuredChatModel();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model || config.model,
      messages,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      stream: false,
    }),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 45_000)]) : AbortSignal.timeout(options.timeoutMs ?? 45_000),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `模型 API 返回 HTTP ${response.status}。`);
  const message = body?.choices?.[0]?.message;
  if (!message || typeof message !== "object") throw new Error("模型 API 没有返回有效的 Chat Completions 消息。");
  return message;
}
