# 7. Deployment View

## 7.1 Deployment Topology

### Current: Single-Host Deployment

```mermaid
graph TD
    subgraph Host Machine
        APID[api-server<br/>Node.js 24 process<br/>Port 8080]
        FED[kg-engine<br/>Vite dev server<br/>Port 18774]
        PG[(PostgreSQL<br/>default port 5432)]
    end

    subgraph Developer IDE
        VSC[VS Code Extension<br/>@workspace/vscode-client]
    end

    BROWSER[Browser] -->|HTTP :18774| FED
    FED -->|API calls :8080| APID
    APID -->|Drizzle ORM TCP| PG
    VSC -->|REST HTTP :8080| APID
    APID -->|HTTPS| LLM[OpenAI-compatible LLM API]
    GH[GitHub] -->|HTTPS POST webhook| APID
```

All three processes (`api-server`, `kg-engine` dev server, PostgreSQL) can run on the same machine. The [VS Code extension is installed locally](adrs/ADR-002-local-first-architecture.md) in the developer's IDE and connects to `api-server` over HTTP (configurable URL in VS Code settings).

### Production Considerations

- `api-server` and PostgreSQL should be [separated onto distinct hosts](adrs/ADR-003-server-side-zero-to-one.md) (or containers) in production.
- `kg-engine` static assets are served separately (Vite build produces `dist/`); static serving from `api-server` is not yet wired — see [11-risks-and-debt.md](11-risks-and-debt.md#d-03).
- No Docker image is provided in v1; raw Node.js process deployment is expected.

---

## 7.2 Environment Variables

| Variable                | Required    | Default       | Description                                                                                                                          |
| ----------------------- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                  | **Yes**     | —             | API server port. Server throws on startup if missing.                                                                                |
| `DATABASE_URL`          | **Yes**     | —             | PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/db`)                                                           |
| `OPENAI_API_KEY`        | **Yes**     | —             | LLM API key. Can be any OpenAI-compatible provider key. Variable name is conventional; configure via LLM config if provider differs. |
| `GITHUB_WEBHOOK_SECRET` | Conditional | —             | Required when GitHub PR integration is active. Used for HMAC-SHA256 webhook validation.                                              |
| `NODE_ENV`              | No          | `development` | Set to `production` for production deployments.                                                                                      |
| Slack / Teams URLs      | Conditional | —             | Integration webhook URLs are stored per-project in the `project_integrations` database table, not as env vars.                       |

---

## 7.3 Development Commands

All commands are run from the repository root unless noted.

```bash
# Install all workspace dependencies
pnpm install

# Apply Drizzle ORM schema to the development database
pnpm --filter @workspace/db run push

# Force (destructive) schema push — drops and recreates tables
pnpm --filter @workspace/db run push-force

# Start api-server in development mode (port 8080, hot reload)
pnpm --filter @workspace/api-server run dev

# Start kg-engine in development mode (port 18774, HMR)
pnpm --filter @workspace/kg-engine run dev

# Typecheck + compile all packages
pnpm run build

# Typecheck only
pnpm run typecheck

# Regenerate React Query hooks and Zod validators from openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Run test suite
pnpm test

# Run tests with coverage
pnpm run test:coverage

# Format all files
pnpm prettier --write .
```

---

## 7.4 CI/CD

Docuvia uses **GitHub Actions** for continuous integration.

| Job                   | Steps                                       | Trigger                |
| --------------------- | ------------------------------------------- | ---------------------- |
| `lint`                | `pnpm prettier --check .`                   | Push to any branch, PR |
| `typecheck-and-build` | `pnpm run build` (which includes typecheck) | Push to any branch, PR |

Jobs run in **parallel**. The workflow file is located at `.github/workflows/ci.yml`.

Runtime environment:

- OS: `ubuntu-latest`
- Node.js: `24.x` (Aligned with production)
- pnpm: `9.x`

---

## 7.5 Deployment Considerations

| Concern                          | Current State                                                                    | Notes                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Docker image**                 | Not provided in v1                                                               | Raw Node.js process deployment; Dockerfile can be added for containerization                                                       |
| **Static frontend serving**      | Not wired for production                                                         | Vite `dist/` output exists; serving from `api-server` via `express.static()` not yet configured — see [D-03](11-risks-and-debt.md) |
| **VS Code extension packaging**  | No `.vsix` build script in CI                                                    | `vsce package` must be run manually; see [D-02](11-risks-and-debt.md)                                                              |
| **Cloud/Self-hosted deployment** | Standard deployment using OpenAI-compatible endpoints                            | Requires `OPENAI_API_KEY` pointing to a compatible endpoint (OpenRouter, Azure, OpenAI, etc.)                                      |
| **Database migrations**          | Run via compiled JS (`node dist/migrate.js`) in production. (Dev may use `push`) | Currently manages 18 tables (increased from 16). Production migrations run from explicit migration files.                          |
| **Secrets management**           | Env vars via `.env` file in development                                          | Production: use secret manager (Vault, AWS Secrets Manager, etc.)                                                                  |

---

## References

- [AGENTS.md](../../AGENTS.md) — Full list of development commands
- [11-risks-and-debt.md](11-risks-and-debt.md) — Known deployment gaps (D-02, D-03)
- [docs/roadmap/master-roadmap.md](../roadmap/master-roadmap.md) — SSOT Roadmap
