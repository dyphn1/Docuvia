# API-First & Codegen Pipeline

This document consolidates everything you need to know about modifying, generating, and consuming APIs in Docuvia. Instead of piecing together architecture docs, ADRs, and package READMEs, follow this playbook.

---

## 1. Objective / Goal

The goal of the API Codegen Pipeline is to eliminate type drift and runtime errors across multiple presentation layers (VS Code Extension, CLI, MCP Server, React Dashboard) by enforcing a Single Source of Truth for API contracts.

## 2. Context & Architecture Links

Docuvia consists of multiple presentation layers.

Docuvia consists of multiple presentation layers (VS Code Extension, CLI, MCP Server, React Dashboard). To prevent type drift and runtime errors across these layers, **we do not hand-write API types, Zod schemas, or fetch functions**.

Instead, we use a strict **API-First** approach:

1. Define the API contract in a single `openapi.yaml` file.
2. Use **Orval** to automatically generate Zod validators (for backend defense) and React Query hooks (for frontend fetching).

## 3. File Locations & Boundary

- **The Contract (Source of Truth):** `lib/api-spec/openapi.yaml`
- **The Codegen Config:** `lib/api-spec/orval.config.cjs`
- **Output - Backend Zod Schemas:** `lib/api-zod/src/generated/`
- **Output - Frontend React Hooks:** `lib/api-client-react/src/generated/`

---

## 4. Agent Guardrails & Invariants

> **⚠️ CRITICAL RULES FOR AI AGENTS**
>
> - **NEVER** hand-write or manually edit TypeScript interfaces for API responses or requests.
> - **NEVER** edit files inside `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. They will be overwritten.
> - **ALWAYS** edit `lib/api-spec/openapi.yaml` first when a new endpoint or property is needed.
> - **ALWAYS** run `pnpm --filter @workspace/api-spec run codegen` immediately after saving the YAML to ensure the types propagate.

---

## 5. Step-by-Step Implementation

### Step 1: Modify the OpenAPI Spec

Always start by defining your route, parameters, request body, and responses in `openapi.yaml`.

### Step 2: Run the Codegen Pipeline

From the root of the project, run:

```bash
pnpm --filter @workspace/api-spec run codegen
```

_This command parses the YAML, overwrites the `generated/` folders in the `api-zod` and `api-client-react` packages, and runs typechecking._

### Step 3: Implement the Backend (Express)

In `@workspace/api-server`, implement your Express route. Use the newly auto-generated Zod schemas to validate incoming payloads.

```typescript
// artifacts/api-server/src/routes/projects.ts
import { getProjectInputBodySchema } from "@workspace/api-zod";

app.post("/api/projects", (req, res) => {
  // 1. Validate payload using the auto-generated Zod schema
  const parsed = getProjectInputBodySchema().parse(req.body);

  // 2. Safe business logic...
});
```

### Step 4: Consume in the Frontend (React / Vite)

In `@workspace/kg-engine`, import the auto-generated TanStack Query hook. You get instant, end-to-end type safety without writing a single fetch wrapper.

```tsx
// artifacts/kg-engine/src/pages/Projects.tsx
import { useListProjects, useCreateProject } from "@workspace/api-client-react";

export function ProjectsPage() {
  // Auto-generated hook handles fetching, caching, and typing!
  const { data: projects, isLoading } = useListProjects();
  const createMutation = useCreateProject();

  // ...
}
```

---

## 4. 🚫 Strict Taboos (What NOT to do)

{% hint style="danger" %}

- **NEVER manually write API interfaces or fetch wrappers.** Always generate them from `openapi.yaml`.
- **NEVER modify files inside any `generated/` directory.** Your changes will be silently overwritten the next time someone runs the codegen command.
- **NEVER skip running the codegen command** before committing if you modified `openapi.yaml`. The CI pipeline will fail (`pnpm run typecheck` will catch the drift).
  {% endhint %}

## 6. Testing & Verification

To verify that the codegen pipeline worked and your API changes are sound:

1. **Type Check**: Run `pnpm run typecheck` at the workspace root to ensure the newly generated types didn't break downstream consumers.
2. **API Tests**: Run `pnpm --filter @workspace/api-server run test` to ensure backend handlers still fulfill the Zod contracts.
3. **Frontend Tests**: Ensure the `kg-engine` builds successfully against the new React Query hooks (`pnpm --filter @workspace/kg-engine run build`).

## 7. Extensibility & Scaling

If you need to support a new presentation layer or a different client (e.g., an external Python SDK or a new Rust client):

- **DO NOT** rewrite the types.
- **DO** extend `lib/api-spec/orval.config.cjs` to generate a new output target (e.g., Axios client, Fetch client, or Zod schemas for a different environment) referencing the exact same `openapi.yaml`.
