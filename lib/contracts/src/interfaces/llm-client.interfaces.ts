/**
 * CLIProxyAPI bridge surface — implemented by lib/llm-api's fetch-backed HTTP client. Pure
 * network I/O speaking CLIProxyAPI's OpenAI-compatible /v1/chat/completions endpoint, with no
 * provider routing, OAuth, or vendor-SDK logic (CLIProxyAPI, a separately, user-run process,
 * handles all of that); see docs/gitbook/adr/llm/LLM-002-cliproxyapi-bridge.md and
 * docs/gitbook/adr/platform/PLAT-003-remote-sync-technology-provider.md for the Technology
 * Provider pattern this mirrors.
 */
/** Per-run config — never read from `process.env` inside the implementation (see
 *  docs/gitbook/architecture/application-lifecycle-and-state.md); the Presentation layer reads
 *  `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL`/`AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY` (naming
 *  carried forward from old Docuvia's `AI_INTEGRATIONS_OPENAI_BASE_URL`/`_API_KEY`) and injects
 *  them via `docuviaMemory`, and the orchestration layer passes them into this `initialize()`
 *  call. `apiKey` is optional — CLIProxyAPI's own gate, only set if the user enabled one; it is
 *  never the underlying provider's (OpenAI/Anthropic/Gemini) native API key. */
export interface LlmClientConfig {
  baseUrl: string;
  apiKey?: string;
}

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatMessageRole;
  content: string | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  toolChoice?:
    "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finishReason: string | null;
}

export interface ChatCompletionResult {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
}

export interface ChatCompletionChunkDelta {
  role?: ChatMessageRole;
  content?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finishReason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface ILlmClient {
  initialize(config: LlmClientConfig): void;
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  streamChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionChunk>;
}
