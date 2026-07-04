# API-First & Codegen Pipeline

This document consolidates everything you need to know about modifying, generating, and consuming APIs in Docuvia. Instead of piecing together architecture docs, ADRs, and package READMEs, follow this playbook.

---

## 1. The Concept: Single Source of Truth

Docuvia consists of multiple presentation layers (VS Code Extension, CLI, MCP Server, React Dashboard). To prevent type drift and runtime errors across these layers, **we do not hand-write API types, Zod schemas, or fetch functions**.

Instead, we use a strict **API-First** approach:

1. Define the API contract in a single `openapi.yaml` file.
2. Use **Orval** to automatically generate Zod validators (for backend defense) and React Query hooks (for frontend fetching).

## 2. Where is it? (File Locations)

- **The Contract (Source of Truth):** `lib/api-spec/openapi.yaml`
- **The Codegen Config:** `lib/api-spec/orval.config.cjs`
- **Output - Backend Zod Schemas:** `lib/api-zod/src/generated/`
- **Output - Frontend React Hooks:** `lib/api-client-react/src/generated/`

---

## 3. Playbook: How to add a new API route

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
