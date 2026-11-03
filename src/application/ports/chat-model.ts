export type ChatMessage = { role: string; content?: unknown; [key: string]: unknown };
export type ChatModelOptions = {
  tools?: unknown[];
  model?: string;
  responseFormat?: { type: "json_object" };
  thinking?: { type: "enabled" | "disabled" };
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Model boundary for application use cases; implementations own credentials and transport. */
export interface ChatModelPort {
  validateConfiguration(): unknown;
  complete(messages: ChatMessage[], options?: ChatModelOptions): Promise<unknown>;
}
