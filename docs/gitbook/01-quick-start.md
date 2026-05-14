# Chapter 1: Quick Start

Welcome to Docuvia! This guide covers the basic setup required to run the Universal VCS Knowledge Graph Engine.

## 1.1 Prerequisites
- **Node.js**: Version 24+
- **pnpm**: Required (npm/yarn will be blocked by the preinstall script).
- **PostgreSQL**: Required for production environments.
- **Supported OS**: Windows, Linux, macOS.

## 1.2 Environment Variables
You must set up the following environment variables:
- `DATABASE_URL`: Connection string for PostgreSQL.
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: Base URL for the OpenAI-compatible API.
- `AI_INTEGRATIONS_OPENAI_API_KEY`: API Key for the LLM endpoint.
- `PORT`: API server port (default 8080).

## 1.3 Installation and Startup
After cloning the repository, install dependencies using pnpm:
```bash
pnpm install
```

Start the API Server (port 8080):
```bash
pnpm --filter @workspace/api-server run dev
```

Start the Frontend application (port 18774):
```bash
pnpm --filter @workspace/kg-engine run dev
```
