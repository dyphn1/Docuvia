import OpenAI from "openai";
import pRetry, { AbortError } from "p-retry";
import { isRateLimitError } from "./batch/utils.js";

export interface LlmAdapterConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Shared retry/backoff wrapper for single (non-batch) LLM calls — used by createLlmClient's
 * chat-completions patch below, and directly by lib/integrations-openai-ai-server/src/audio and
 * .../image clients, which construct their own raw OpenAI instances (see Issue 1.21).
 */
export function withLlmRetry<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (error: unknown) {
        if (isRateLimitError(error) || String(error).includes("timeout")) {
          throw error; // Let pRetry handle it
        }
        throw new AbortError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    { retries: 5, minTimeout: 1000, maxTimeout: 15000, factor: 2 }
  );
}

export function createLlmClient(config?: Partial<LlmAdapterConfig>): OpenAI {
  const provider = config?.provider?.toLowerCase() || "openai";

  let apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  let baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  if (provider === "ollama" || provider === "local") {
    baseURL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
    apiKey = "ollama";
  }

  if (config?.apiKey) apiKey = config.apiKey;
  if (config?.baseUrl) baseURL = config.baseUrl;

  if (!baseURL) {
    throw new Error("Base URL must be set. Did you forget to provision the LLM integration?");
  }

  if (!apiKey) {
    throw new Error("API Key must be set. Did you forget to provision the LLM integration?");
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  // A.5 - Issue 1.21 Implement Retry wrapper around the raw client chat completions
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = (async (...args: any[]) => {
    return withLlmRetry(() => (originalCreate as any)(...args));
  }) as any;

  return client;
}

// Retained for backward compatibility during migration
export const openai = createLlmClient();
