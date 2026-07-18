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

export const ChatMessageRoles = {
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
} as const;
export type ChatMessageRole =
  (typeof ChatMessageRoles)[keyof typeof ChatMessageRoles];

/** The only tool kind CLIProxyAPI's OpenAI-compatible surface supports today. */
export const CHAT_TOOL_TYPE = "function" as const;

/** Values for `ChatCompletionRequest.toolChoice` short-hand modes ("auto" lets the model decide, "none" forbids tool calls). */
export const ChatToolChoiceModes = {
  AUTO: "auto",
  NONE: "none",
} as const;

export interface ChatToolCall {
  id: string;
  type: typeof CHAT_TOOL_TYPE;
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
  type: typeof CHAT_TOOL_TYPE;
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
    | typeof ChatToolChoiceModes.AUTO
    | typeof ChatToolChoiceModes.NONE
    | { type: typeof CHAT_TOOL_TYPE; function: { name: string } };
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

/** Result of `ILlmClient.checkAvailability()` (phase1-decision-integration.md §10e bullet 3;
 *  decision 1e) -- mirrors `EdgeResolutionAvailability`'s exact shape. */
export interface LlmClientAvailability {
  available: boolean;
  /** Human-readable reason when `available` is `false`. Always present when `available` is
   *  `false`. */
  reason?: string;
}

export interface ILlmClient {
  initialize(config: LlmClientConfig): void;
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  streamChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionChunk>;
  /**
   * Lightweight reachability probe against `config.baseUrl` (decision 1e) -- a check that a
   * server is there and responding, never *does this exact route exist* (any received HTTP
   * response, even a 4xx/5xx, counts as `available: true`; only a network-level failure --
   * connection refused, DNS failure, timeout -- is `available: false`). Never throws -- a check
   * that itself fails is reported as `available: false`, mirroring
   * `IEdgeResolutionProvider.checkAvailability()`'s contract exactly. Unlike that method, this
   * takes no argument: `ILlmClient` is configured via `initialize()` before use, not per-call.
   */
  checkAvailability(): Promise<LlmClientAvailability>;
}
