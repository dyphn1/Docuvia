import {
  CHAT_TOOL_TYPE,
  DocuviaError,
  ErrorCodes,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  ChatMessageRoles,
  type ChatToolCall,
  type ILlmClient,
  type LlmClientAvailability,
  type LlmClientConfig,
} from "@workspace/contracts";
import { LlmApiHttp } from "./constants/http.js";
import { LlmApiMessages } from "./constants/messages.js";
import { LlmApiPaths } from "./constants/paths.js";
import {
  parseWireChatCompletionChunk,
  parseWireChatCompletionResult,
  type WireChatCompletionChunk,
  type WireChatCompletionResult,
  type WireChatMessage,
  type WireChatToolCall,
} from "./response-validation.js";

const REQUEST_TIMEOUT_MS = 30000;
/** Short timeout for `checkAvailability()`'s liveness probe (decision 1e) -- sized for "is a
 *  server there and responding," not a real chat completion; do not reuse `REQUEST_TIMEOUT_MS`,
 *  which is sized for that heavier call. Consistent with `NPX_PROBE_TIMEOUT_MS`/
 *  `NETWORK_CHECK_TIMEOUT_MS` precedent elsewhere in this codebase. */
const AVAILABILITY_PROBE_TIMEOUT_MS = 4000;

/**
 * Native-`fetch`-backed CLIProxyAPI HTTP client — the Technology Provider wrapping CLIProxyAPI's
 * OpenAI-compatible `/v1/chat/completions` endpoint (see
 * docs/gitbook/adr/llm/LLM-002-cliproxyapi-bridge.md). A Silent Worker — takes no `ILogger` —
 * and never leaks a native error; every failure is caught and wrapped as `DocuviaError`. Config
 * (`baseUrl`/`apiKey`) is injected via `initialize()`, never read from `process.env` directly
 * (see docs/gitbook/architecture/application-lifecycle-and-state.md).
 */
export class FetchLlmClient implements ILlmClient {
  private config: LlmClientConfig | undefined;

  public initialize(config: LlmClientConfig): void {
    this.config = config;
  }

  private getConfig(): LlmClientConfig {
    if (!this.config) {
      throw new DocuviaError(
        ErrorCodes.LLM_NOT_INITIALIZED,
        LlmApiMessages.CLIENT_USED_BEFORE_INITIALIZE,
      );
    }
    return this.config;
  }

  private async parseErrorBody(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: string };
      return body.error ?? res.statusText;
    } catch {
      return res.statusText;
    }
  }

  /**
   * Normalizes `baseUrl` before appending `LlmApiPaths.CHAT_COMPLETIONS`, so a `baseUrl` that
   * already ends in a trailing `/v1` doesn't produce a doubled `/v1/v1/...` path. Only a
   * trailing `/v1` path segment is stripped; names such as `/v1beta` and `/apiv1` are preserved.
   */
  private buildCompletionsUrl(baseUrl: string): string {
    const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const normalized = trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
    return `${normalized}${LlmApiPaths.CHAT_COMPLETIONS}`;
  }

  private buildHeaders(
    config: LlmClientConfig,
    accept?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      [LlmApiHttp.HEADER_CONTENT_TYPE]: LlmApiHttp.CONTENT_TYPE_JSON,
    };
    if (accept) headers.Accept = accept;
    if (config.apiKey)
      headers[LlmApiHttp.HEADER_AUTHORIZATION] = LlmApiHttp.bearerAuth(
        config.apiKey,
      );
    return headers;
  }

  private toWireToolCalls(
    toolCalls: ChatToolCall[] | undefined,
  ): Record<string, unknown>[] | undefined {
    if (!toolCalls) return undefined;
    return toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: toolCall.type,
      function: toolCall.function,
    }));
  }

  private toWireMessage(message: ChatMessage): Record<string, unknown> {
    return {
      role: message.role,
      content: message.content,
      ...(message.name !== undefined ? { name: message.name } : {}),
      ...(message.toolCallId !== undefined
        ? { tool_call_id: message.toolCallId }
        : {}),
      ...(message.toolCalls !== undefined
        ? { tool_calls: this.toWireToolCalls(message.toolCalls) }
        : {}),
    };
  }

  private buildRequestBody(
    request: ChatCompletionRequest,
    stream: boolean,
  ): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map((message) => this.toWireMessage(message)),
      ...(request.tools !== undefined ? { tools: request.tools } : {}),
      ...(request.toolChoice !== undefined
        ? { tool_choice: request.toolChoice }
        : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens !== undefined
        ? { max_tokens: request.maxTokens }
        : {}),
      stream,
    };
  }

  private fromWireToolCalls(
    toolCalls: WireChatToolCall[] | undefined,
  ): ChatToolCall[] | undefined {
    if (!toolCalls) return undefined;
    return toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: toolCall.type,
      function: toolCall.function,
    }));
  }

  private fromWireMessage(wireMessage: WireChatMessage): ChatMessage {
    return {
      role: wireMessage.role,
      content: wireMessage.content,
      ...(wireMessage.name !== undefined ? { name: wireMessage.name } : {}),
      ...(wireMessage.tool_call_id !== undefined
        ? { toolCallId: wireMessage.tool_call_id }
        : {}),
      ...(wireMessage.tool_calls !== undefined
        ? { toolCalls: this.fromWireToolCalls(wireMessage.tool_calls) }
        : {}),
    };
  }

  private fromWireResult(
    wireResult: WireChatCompletionResult,
  ): ChatCompletionResult {
    return {
      id: wireResult.id,
      model: wireResult.model,
      choices: wireResult.choices.map((choice) => ({
        index: choice.index,
        message: this.fromWireMessage(choice.message),
        finishReason: choice.finish_reason,
      })),
    };
  }

  private fromWireChunk(
    wireChunk: WireChatCompletionChunk,
  ): ChatCompletionChunk {
    return {
      id: wireChunk.id,
      model: wireChunk.model,
      choices: wireChunk.choices.map((choice) => ({
        index: choice.index,
        delta: {
          ...(choice.delta.role !== undefined
            ? { role: choice.delta.role }
            : {}),
          ...(choice.delta.content !== undefined
            ? { content: choice.delta.content }
            : {}),
          ...(choice.delta.tool_calls !== undefined
            ? { toolCalls: this.fromWireToolCalls(choice.delta.tool_calls) }
            : {}),
        },
        finishReason: choice.finish_reason,
      })),
    };
  }

  /**
   * `doctor`'s T7 reachability pre-flight: a lightweight `GET config.baseUrl`. Any received
   * Response counts as reachable; only network/timeout failures return `available: false`.
   */
  public async checkAvailability(): Promise<LlmClientAvailability> {
    try {
      const config = this.getConfig();
      await fetch(config.baseUrl, {
        method: LlmApiHttp.METHOD_GET,
        signal: AbortSignal.timeout(AVAILABILITY_PROBE_TIMEOUT_MS),
      });
      return { available: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        available: false,
        reason: LlmApiMessages.availabilityCheckFailedWithReason(message),
      };
    }
  }

  /** Issue #134's faithful Tier C bridge probe against the actual completions route. */
  public async checkBridgeReachability(
    model: string,
  ): Promise<LlmClientAvailability> {
    try {
      const config = this.getConfig();
      const res = await fetch(this.buildCompletionsUrl(config.baseUrl), {
        method: LlmApiHttp.METHOD_POST,
        headers: this.buildHeaders(config),
        body: JSON.stringify({
          model,
          messages: [{ role: ChatMessageRoles.USER, content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(AVAILABILITY_PROBE_TIMEOUT_MS),
      });
      if (!res.ok) {
        const message = await this.parseErrorBody(res);
        return {
          available: false,
          reason: LlmApiMessages.bridgeProbeRejectedWithReason(
            res.status,
            message,
          ),
        };
      }
      return { available: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        available: false,
        reason: LlmApiMessages.bridgeProbeFailedWithReason(message),
      };
    }
  }

  public async chatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> {
    const config = this.getConfig();
    let res: Response;
    try {
      res = await fetch(this.buildCompletionsUrl(config.baseUrl), {
        method: LlmApiHttp.METHOD_POST,
        headers: this.buildHeaders(config),
        body: JSON.stringify(this.buildRequestBody(request, false)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
        LlmApiMessages.CHAT_COMPLETION_FAILED,
        err,
      );
    }

    if (!res.ok) {
      const message = await this.parseErrorBody(res);
      if (res.status === 429) {
        throw new DocuviaError(
          ErrorCodes.LLM_RATE_LIMITED,
          LlmApiMessages.chatCompletionFailedWithReason(message),
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new DocuviaError(
          ErrorCodes.LLM_AUTH_FAILED,
          LlmApiMessages.chatCompletionFailedWithReason(message),
        );
      }
      throw new DocuviaError(
        ErrorCodes.LLM_HTTP_FAILED,
        LlmApiMessages.chatCompletionFailedWithReason(message),
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.LLM_INVALID_RESPONSE,
        LlmApiMessages.CHAT_COMPLETION_INVALID_JSON,
        err,
      );
    }

    try {
      return this.fromWireResult(parseWireChatCompletionResult(body));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.LLM_INVALID_RESPONSE,
        LlmApiMessages.CHAT_COMPLETION_INVALID_RESPONSE,
        err,
      );
    }
  }

  public streamChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionChunk> {
    const config = this.getConfig();
    const headers = this.buildHeaders(
      config,
      LlmApiHttp.CONTENT_TYPE_EVENT_STREAM,
    );
    const body = JSON.stringify(this.buildRequestBody(request, true));
    const url = this.buildCompletionsUrl(config.baseUrl);
    const parseErrorBody = this.parseErrorBody.bind(this);
    const fromWireChunk = this.fromWireChunk.bind(this);

    async function* generate(): AsyncGenerator<ChatCompletionChunk> {
      const res = await fetchSseResponse(url, headers, body, parseErrorBody);
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex: number;
        while (
          (separatorIndex = buffer.indexOf(LlmApiHttp.SSE_BLOCK_SEPARATOR)) !==
          -1
        ) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(
            separatorIndex + LlmApiHttp.SSE_BLOCK_SEPARATOR.length,
          );

          const result = parseSseBlock(block, fromWireChunk);
          if (result.kind === "done") return;
          if (result.kind === "chunk") yield result.chunk;
        }
      }
    }

    return generate();
  }
}

async function fetchSseResponse(
  url: string,
  headers: Record<string, string>,
  body: string,
  parseErrorBody: (res: Response) => Promise<string>,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: LlmApiHttp.METHOD_POST,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw DocuviaError.wrap(
      ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
      LlmApiMessages.CHAT_COMPLETION_STREAM_FAILED,
      err,
    );
  }

  if (!res.ok) {
    const message = await parseErrorBody(res);
    throw new DocuviaError(
      ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
      LlmApiMessages.chatCompletionStreamFailedWithReason(message),
    );
  }

  return res;
}

type SseBlockResult =
  | { kind: "chunk"; chunk: ChatCompletionChunk }
  | { kind: "done" }
  | { kind: "skip" };

function parseSseBlock(
  block: string,
  fromWireChunk: (wireChunk: WireChatCompletionChunk) => ChatCompletionChunk,
): SseBlockResult {
  const line = block.trim();
  if (!line) return { kind: "skip" };
  const payload = line.startsWith(LlmApiHttp.SSE_DATA_PREFIX)
    ? line.slice(LlmApiHttp.SSE_DATA_PREFIX.length)
    : line;
  if (payload === LlmApiHttp.SSE_DONE_SENTINEL) return { kind: "done" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    throw DocuviaError.wrap(
      ErrorCodes.LLM_STREAM_FAILED,
      LlmApiMessages.CHAT_COMPLETION_STREAM_INVALID_JSON,
      err,
    );
  }

  try {
    return {
      kind: "chunk",
      chunk: fromWireChunk(parseWireChatCompletionChunk(parsed)),
    };
  } catch (err) {
    throw DocuviaError.wrap(
      ErrorCodes.LLM_STREAM_FAILED,
      LlmApiMessages.CHAT_COMPLETION_STREAM_INVALID_RESPONSE,
      err,
    );
  }
}
