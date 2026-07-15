import {
  DocuviaError,
  ErrorCodes,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatToolCall,
  type ILlmClient,
  type LlmClientConfig,
} from "@workspace/contracts";

const REQUEST_TIMEOUT_MS = 30000;

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
        "FetchLlmClient used before initialize() was called",
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

  private buildHeaders(
    config: LlmClientConfig,
    accept?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (accept) headers.Accept = accept;
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
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
          type: "function";
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
      type: "function";
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
          type: "function";
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

  public async chatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> {
    const config = this.getConfig();
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(config),
        body: JSON.stringify(this.buildRequestBody(request, false)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
        "Chat completion failed",
        err,
      );
    }

    if (!res.ok) {
      const message = await this.parseErrorBody(res);
      throw new DocuviaError(
        ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
        `Chat completion failed: ${message}`,
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
        "Chat completion failed: response body was not valid JSON",
        err,
      );
    }
  }

  public streamChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionChunk> {
    const config = this.getConfig();
    const headers = this.buildHeaders(config, "text/event-stream");
    const body = JSON.stringify(this.buildRequestBody(request, true));
    const parseErrorBody = this.parseErrorBody.bind(this);
    const fromWireChunk = this.fromWireChunk.bind(this);

    async function* generate(): AsyncGenerator<ChatCompletionChunk> {
      let res: Response;
      try {
        res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw DocuviaError.wrap(
          ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
          "Chat completion stream failed",
          err,
        );
      }

      if (!res.ok) {
        const message = await parseErrorBody(res);
        throw new DocuviaError(
          ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
          `Chat completion stream failed: ${message}`,
        );
      }

      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex: number;
        while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);

          const line = block.trim();
          if (!line) continue;
          const payload = line.startsWith("data: ")
            ? line.slice("data: ".length)
            : line;
          if (payload === "[DONE]") return;

          try {
            const wireChunk = JSON.parse(payload) as Parameters<
              typeof fromWireChunk
            >[0];
            yield fromWireChunk(wireChunk);
          } catch (err) {
            throw DocuviaError.wrap(
              ErrorCodes.LLM_STREAM_FAILED,
              "Chat completion stream failed: chunk was not valid JSON",
              err,
            );
          }
        }
      }
    }

    return generate();
  }
}
