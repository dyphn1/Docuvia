# Chapter 9: FAQ & Troubleshooting

Common issues and how to resolve them.

### The Dashboard displays "Dashboard data unavailable" and numbers are 0.
Ensure that both the API Server and Database are running correctly. Check the API Server logs for connection errors.

### Creating a Project returns HTTP 500 Internal Server Error.
Verify that the `DATABASE_URL` is set correctly and the database schema has been initialized via migrations.

### The Review Queue is empty after running Generate.
The LLM might be returning unparseable JSON. Check the API logs for `JSON.parse` errors or LLM timeout exceptions.

### The Query page returns no results.
Ensure that vector embeddings have been generated for your nodes. Verify your OpenAI integration is working and `AI_INTEGRATIONS_OPENAI_API_KEY` is valid.

### Cannot connect to local Ollama model.
As noted in the Known Limitations, Ollama is not officially supported yet. You must use an OpenAI-compatible proxy (like LiteLLM) to route requests to Ollama.
