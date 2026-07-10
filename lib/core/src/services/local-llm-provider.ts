import {
  LLMOrchestrator,
  openaiTransport,
  anthropicTransport,
  geminiTransport,
  ProviderTransport,
} from "@workspace/llm-orchestrator";

export interface LocalLlmResolution {
  orchestrator: LLMOrchestrator;
  model: string;
}

/**
 * DB-free counterpart to `getLlmOrchestratorForProject()` (`llm-provider.ts`), which is
 * Postgres-backed (`llmConfigsTable` lookup by `projectId`) and unsuitable for a local-first
 * CLI command with no project id or Postgres connection (`docuvia analyze <path>`). Mirrors
 * that function's provider-selection branching and env var names so a user who's already
 * configured the server-side integration doesn't need a second, differently-named set of
 * secrets — but resolves purely from environment variables.
 */
export function resolveLocalLlmOrchestrator(modelOverride?: string): LocalLlmResolution {
  const provider = (process.env.DOCUVIA_LLM_PROVIDER || "openai").toLowerCase();

  let apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  let baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
  let transport: ProviderTransport = openaiTransport;
  const model = modelOverride || process.env.AI_OPENAI_FAST_MODEL || "gpt-5.2";

  if (provider === "ollama" || provider === "local") {
    baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
    apiKey = "ollama";
    transport = openaiTransport;
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

  if (!apiKey && provider !== "ollama" && provider !== "local") {
    throw new Error(
      "No LLM API key configured. Set OPENAI_API_KEY (or ANTHROPIC_API_KEY / GEMINI_API_KEY) to use 'docuvia analyze <path>'."
    );
  }

  const orchestrator = new LLMOrchestrator({
    profile: { name: provider, baseUrl, defaultModel: model },
    transport,
    apiKey,
  });

  return { orchestrator, model };
}
