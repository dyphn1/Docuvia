import {
  CHAT_TOOL_TYPE,
  ChatMessageRoles,
  type ChatMessageRole,
} from "@workspace/contracts";

export interface WireChatToolCall {
  id: string;
  type: typeof CHAT_TOOL_TYPE;
  function: { name: string; arguments: string };
}

export interface WireChatMessage {
  role: ChatMessageRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: WireChatToolCall[];
}

export interface WireChatCompletionResult {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: WireChatMessage;
    finish_reason: string | null;
  }>;
}

export interface WireChatCompletionChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: ChatMessageRole;
      content?: string;
      tool_calls?: WireChatToolCall[];
    };
    finish_reason: string | null;
  }>;
}

const CHAT_MESSAGE_ROLE_VALUES = new Set<string>(
  Object.values(ChatMessageRoles),
);

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string`);
  }
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}

function chatRole(value: unknown, path: string): ChatMessageRole {
  const role = string(value, path);
  if (!CHAT_MESSAGE_ROLE_VALUES.has(role)) {
    throw new TypeError(`${path} must be a supported chat role`);
  }
  return role as ChatMessageRole;
}

function validateToolCalls(value: unknown, path: string): void {
  for (const [index, candidate] of array(value, path).entries()) {
    const toolCall = record(candidate, `${path}[${index}]`);
    string(toolCall.id, `${path}[${index}].id`);
    if (toolCall.type !== CHAT_TOOL_TYPE) {
      throw new TypeError(`${path}[${index}].type must be ${CHAT_TOOL_TYPE}`);
    }
    const fn = record(toolCall.function, `${path}[${index}].function`);
    string(fn.name, `${path}[${index}].function.name`);
    string(fn.arguments, `${path}[${index}].function.arguments`);
  }
}

function validateMessage(value: unknown, path: string): void {
  const message = record(value, path);
  chatRole(message.role, `${path}.role`);
  nullableString(message.content, `${path}.content`);
  if (message.name !== undefined) string(message.name, `${path}.name`);
  if (message.tool_call_id !== undefined)
    string(message.tool_call_id, `${path}.tool_call_id`);
  if (message.tool_calls !== undefined)
    validateToolCalls(message.tool_calls, `${path}.tool_calls`);
}

/**
 * Validates only the fields Docuvia's `ChatCompletionResult` contract requires. Provider-specific
 * extension fields are deliberately tolerated so the bridge remains forward-compatible.
 */
export function parseWireChatCompletionResult(
  value: unknown,
): WireChatCompletionResult {
  const result = record(value, "response");
  string(result.id, "response.id");
  string(result.model, "response.model");
  for (const [index, candidate] of array(
    result.choices,
    "response.choices",
  ).entries()) {
    const choice = record(candidate, `response.choices[${index}]`);
    number(choice.index, `response.choices[${index}].index`);
    validateMessage(choice.message, `response.choices[${index}].message`);
    nullableString(
      choice.finish_reason,
      `response.choices[${index}].finish_reason`,
    );
  }
  return value as WireChatCompletionResult;
}

/** Runtime counterpart of `ChatCompletionChunk`: reject valid JSON with a wrong shape. */
export function parseWireChatCompletionChunk(
  value: unknown,
): WireChatCompletionChunk {
  const chunk = record(value, "chunk");
  string(chunk.id, "chunk.id");
  string(chunk.model, "chunk.model");
  for (const [index, candidate] of array(
    chunk.choices,
    "chunk.choices",
  ).entries()) {
    const choice = record(candidate, `chunk.choices[${index}]`);
    number(choice.index, `chunk.choices[${index}].index`);
    const delta = record(choice.delta, `chunk.choices[${index}].delta`);
    if (delta.role !== undefined)
      chatRole(delta.role, `chunk.choices[${index}].delta.role`);
    if (delta.content !== undefined)
      string(delta.content, `chunk.choices[${index}].delta.content`);
    if (delta.tool_calls !== undefined)
      validateToolCalls(
        delta.tool_calls,
        `chunk.choices[${index}].delta.tool_calls`,
      );
    nullableString(
      choice.finish_reason,
      `chunk.choices[${index}].finish_reason`,
    );
  }
  return value as WireChatCompletionChunk;
}
