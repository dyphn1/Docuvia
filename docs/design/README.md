# Docuvia — Software Architecture & Design Documentation

> Universal VCS Knowledge Graph Engine: ingest commit history, construct a three-tier knowledge graph, and expose it via REST, MCP, and VS Code UI.

## About This Documentation

This suite documents the **post-implementation architecture** of Docuvia v1.0. It follows the [arc42](https://arc42.org/) structure (sections 1–12), adapted for a TypeScript monorepo. All 42 planned roadmap items are complete at the time of writing.

This is the authoritative design record for engineers joining the project, AI agents requiring architectural context, and operators deploying the system.

---

## Documentation Index

| # | Document | Description |
|---|----------|-------------|
| — | [README.md](README.md) (this file) | Master index |
| 1 | [01-introduction-and-goals.md](01-introduction-and-goals.md) | Vision, quality goals, stakeholders |
| 2 | [02-constraints.md](02-constraints.md) | Technical, org, regulatory constraints |
| 3 | [03-context-and-scope.md](03-context-and-scope.md) | System boundary, external interfaces |
| 4 | [04-solution-strategy.md](04-solution-strategy.md) | Key technology choices and rationale |
| 5 | [05-building-blocks.md](05-building-blocks.md) | Monorepo packages, module responsibilities |
| 6 | [06-runtime-scenarios.md](06-runtime-scenarios.md) | Key runtime flows (ingest, generate, query) |
| 7 | [07-deployment.md](07-deployment.md) | Deployment topology, environments |
| 8 | [08-crosscutting-concepts.md](08-crosscutting-concepts.md) | Domain model, architecture patterns, Coding Rules |
| 9 | [09-architectural-decisions.md](09-architectural-decisions.md) | ADR index + key decisions |
| 10 | [10-quality-requirements.md](10-quality-requirements.md) | Quality goals, NFRs, performance targets |
| 11 | [11-risks-and-debt.md](11-risks-and-debt.md) | Known gaps and technical debt |
| 12 | [12-glossary.md](12-glossary.md) | Full product terminology |

---

## VS Code Extension Design (Supplementary)

The VS Code extension has its own detailed design documentation under [`artifacts/vscode-client/design/`](../../artifacts/vscode-client/design/):

- [ROUTER.md](../../artifacts/vscode-client/design/ROUTER.md) — Extension routing architecture (authoritative)
- [chat-participant/slash-commands.md](../../artifacts/vscode-client/design/chat-participant/slash-commands.md)
- [command-palette/run-extraction.md](../../artifacts/vscode-client/design/command-palette/run-extraction.md)
- [knowledge-graph/store.md](../../artifacts/vscode-client/design/knowledge-graph/store.md)
- [ui-ux/user-journeys.md](../../artifacts/vscode-client/design/ui-ux/user-journeys.md)

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [docs/roadmap-checklist.md](../roadmap-checklist.md) | Phase-by-phase completion checklist (all 42 items) |
| [docs/implementation-roadmap.md](../implementation-roadmap.md) | Implementation roadmap with phase descriptions |
| [docs/vscode-extension-roadmap.md](../vscode-extension-roadmap.md) | VS Code extension roadmap |
| [AGENTS.md](../../AGENTS.md) | AI developer guide — commands, conventions, agent definitions |
