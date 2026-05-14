# Chapter 3: Model Configuration

Learn how to configure different Large Language Models (LLMs) to power the knowledge extraction and querying processes.

## 3.1 Supported LLM Providers

| Type   | Provider | Requires API Key |
|--------|----------|------------------|
| Cloud  | OpenAI-compatible API | Yes |
| Cloud  | Anthropic | Yes (Replit environment only) |
| Cloud  | Google Gemini | Yes (Replit environment only) |
| Local  | Ollama | No |

## 3.2 Setting Up API Keys and Endpoints
Configure the base URL and API key for OpenAI-compatible endpoints using environment variables:
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`

## 3.3 Local Models: Ollama + Gemma 3 12B
> ⚠️ **Note**: Local Ollama inference is currently on the roadmap. The codebase only implements the OpenAI-compatible API client, and the Ollama adapter is not yet available.

Future updates will support setting `OLLAMA_HOST` to allow fully local AI processing without sending data to external APIs.

## 3.4 Task-based Model Strategy
- **L1/L2 Tagging**: Recommended to use lightweight, fast models to reduce costs.
- **L3 Deep Analysis**: Recommended to use 70B+ parameter models for high-quality technical reasoning extraction.
- **Per-project Settings**: You can override model settings per project in the `llm_configs` table.
