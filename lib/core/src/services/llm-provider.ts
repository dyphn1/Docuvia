import { db, llmConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  LLMOrchestrator,
  openaiTransport,
  anthropicTransport,
  geminiTransport,
} from "@workspace/llm-orchestrator";

export async function getLlmOrchestratorForProject(projectId?: number) {
  let provider = "openai";
  let model = process.env.AI_OPENAI_FAST_MODEL || "gpt-5.2";

  if (projectId) {
    const [config] = await db
      .select()
      .from(llmConfigsTable)
      .where(eq(llmConfigsTable.projectId, projectId))
      .limit(1);

    if (config) {
      provider = config.provider || "openai";
      if (config.model) model = config.model;
    }
  }

  let apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  let baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
  let transport = openaiTransport;

  provider = provider.toLowerCase();

  if (provider === "ollama" || provider === "local") {
    baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
    apiKey = "ollama";
    transport = openaiTransport; // ollama uses openai format
  } else if (provider === "anthropic") {
    baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1/messages";
    apiKey = process.env.ANTHROPIC_API_KEY || apiKey;
    transport = anthropicTransport;
  } else if (provider === "gemini") {
    baseUrl =
      process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
    apiKey = process.env.GEMINI_API_KEY || apiKey;
    transport = geminiTransport;
  }

  if (!baseUrl) {
    throw new Error("Base URL must be set.");
  }
  if (!apiKey) {
    throw new Error("API Key must be set.");
  }

  const orchestrator = new LLMOrchestrator({
    profile: {
      name: provider,
      baseUrl,
      defaultModel: model,
    },
    transport,
    apiKey,
  });

  return { orchestrator, model, apiKey, baseUrl, provider };
}

// Deprecated
export async function getLlmClientForProject(projectId?: number) {
  return null as any;
}
