# Chapter 8: Known Limitations

Please be aware of the following current limitations in the system.

| Feature | Severity | Description |
|---------|----------|-------------|
| Multi-hop Impact Traversal | 🟠 Medium | Currently only one-hop traversal is supported; multi-layer dependency analysis is not yet implemented. |
| Cross-project node_links | 🟠 Medium | Approved cross-project links do not automatically create relationship records in the DB. |
| Ollama / Local Inference | 🟡 Low | Only the OpenAI-compatible API is implemented; no dedicated Ollama adapter yet. |
| VS Code Extension | 🟡 Low | Server API exists, but the `.vsix` client package is missing. |
| Multi-Provider Adapters | 🟡 Low | Anthropic and Gemini adapters are strictly limited to the Replit platform environment. |
| Test Suite | 🟡 Low | Tests live in root `test/`, but coverage is still narrow: mostly feature contract checks plus VS Code extension endpoints. |
