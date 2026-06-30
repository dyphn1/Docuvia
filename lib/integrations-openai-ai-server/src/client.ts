import OpenAI from "openai";

export interface LlmAdapterConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
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

  return new OpenAI({
    apiKey,
    baseURL,
  });
}

// Retained for backward compatibility during migration
export const openai = createLlmClient();
