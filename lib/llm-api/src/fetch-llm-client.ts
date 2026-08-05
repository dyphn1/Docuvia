import {
  CHAT_TOOL_TYPE,
  DocuviaError,
  ErrorCodes,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatToolCall,
  type ILlmClient,
  type LlmClientAvailability,
  type LlmClientConfig,
} from "@workspace/contracts";
import { LlmApiHttp } from "./constants/http.js";
import { LlmApiMessages } from "./constants/messages.js";
import { LlmApiPaths } from "./constants/paths.js";

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
   * already ends in a trailing `/v1` (e.g. OpenRouter's documented OpenAI-SDK-compatible
   * convention, `https://openrouter.ai/api/v1`) doesn't produce a doubled `/v1/v1/...` path.
   * CLIProxyAPI's own convention has no `/v1` in `baseUrl` at all (see
   * docs/gitbook/adr/llm/LLM-002-cliproxyapi-bridge.md), so this makes the client tolerate both
   * without the caller needing to know which. Only a trailing `/v1` *segment* (the literal final
   * path segment, not a substring anywhere else) is stripped -- `https://host/v1beta` and
   * `https://host/apiv1` are left untouched.
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
    toolCalls:
      | Array<{
          id: string;
          type: typeof CHAT_TOOL_TYPE;
          function: { name: string; arguments: string };
        }>
      | undefined,
  ): ChatToolCall[] | undefined {
    if (!toolCalls) return undefined;
    return toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: toolCall.type,
      function: toolCall.function,
    }));
  }

  private fromWireMessage(wireMessage: {
    role: ChatMessage["role"];
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: typeof CHAT_TOOL_TYPE;
      function: { name: string; arguments: string };
    }>;
  }): ChatMessage {
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

  private fromWireResult(wireResult: {
    id: string;
    model: string;
    choices: Array<{
      index: number;
      message: Parameters<FetchLlmClient["fromWireMessage"]>[0];
      finish_reason: string | null;
    }>;
  }): ChatCompletionResult {
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

  private fromWireChunk(wireChunk: {
    id: string;
    model: string;
    choices: Array<{
      index: number;
      delta: {
        role?: ChatMessage["role"];
        content?: string;
        tool_calls?: Array<{
          id: string;
          type: typeof CHAT_TOOL_TYPE;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string | null;
    }>;
  }): ChatCompletionChunk {
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
   * `doctor`'s T7 reachability pre-flight (decision 1e): a lightweight `GET config.baseUrl` --
   * not `chatCompletion`'s full request/response contract, since this is a reachability probe,
   * not a functional check. Any received `Response` (regardless of status code) is
   * `available: true`; any thrown error (network failure, timeout, DNS) is caught and reported as
   * `available: false` rather than propagating. Never throws.
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
      throw new DocuviaError(
        ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
        LlmApiMessages.chatCompletionFailedWithReason(message),
      );
    }

    try {
      const body = (await res.json()) as Parameters<
        FetchLlmClient["fromWireResult"]
      >[0];
      return this.fromWireResult(body);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
        LlmApiMessages.CHAT_COMPLETION_INVALID_JSON,
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

/**
 * `fetch`es the SSE stream response for `streamChatCompletion`'s `generate`, wrapping a network
 * failure as `DocuviaError` and rejecting a non-OK response with the parsed error body — the
 * request/response-validation portion pulled out of `generate` to keep it under the complexity
 * budget. The returned `Response`'s `.body` may still be `null` (caller's concern).
 */
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

/** One `\n\n`-delimited SSE block from `generate`'s read buffer, parsed into either a decoded
 *  chunk, the `[DONE]` sentinel (stream should stop), or a blank line to skip. */
type SseBlockResult =
  | { kind: "chunk"; chunk: ChatCompletionChunk }
  | { kind: "done" }
  | { kind: "skip" };

/**
 * Parses a single SSE `block` (already split on `\n\n`) into an `SseBlockResult` — the
 * per-block decoding portion pulled out of `generate`'s inner `while` loop.
 */
function parseSseBlock(
  block: string,
  fromWireChunk: (
    wireChunk: Parameters<FetchLlmClient["fromWireChunk"]>[0],
  ) => ChatCompletionChunk,
): SseBlockResult {
  const line = block.trim();
  if (!line) return { kind: "skip" };
  const payload = line.startsWith(LlmApiHttp.SSE_DATA_PREFIX)
    ? line.slice(LlmApiHttp.SSE_DATA_PREFIX.length)
    : line;
  if (payload === LlmApiHttp.SSE_DONE_SENTINEL) return { kind: "done" };

  try {
    const wireChunk = JSON.parse(payload) as Parameters<
      typeof fromWireChunk
    >[0];
    return { kind: "chunk", chunk: fromWireChunk(wireChunk) };
  } catch (err) {
    throw DocuviaError.wrap(
      ErrorCodes.LLM_STREAM_FAILED,
      LlmApiMessages.CHAT_COMPLETION_STREAM_INVALID_JSON,
      err,
    );
  }
}
