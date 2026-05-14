# Chapter 7: API and MCP Reference

Technical specifications for APIs and protocol endpoints.

## 7.1 MCP Tool Endpoints
- **search_knowledge**: Accepts natural language string; returns relevant L2/L3 nodes.
- **get_dependencies**: Accepts a node ID; returns up/downstream nodes.
- **impact_analysis**: Accepts node IDs; returns potential breaking changes.
- **get_decision_record**: Retrieves historical architectural decisions.
- **list_projects**: Returns all tracked repositories.

## 7.2 REST API Overview
- `/projects`: CRUD operations for repositories.
- `/ingest` & `/generate`: Trigger pipeline jobs.
- `/review_tasks`: Manage the human-in-the-loop review queue.
- `/export`: Download JSON or Markdown knowledge bases.
