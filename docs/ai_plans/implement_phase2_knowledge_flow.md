# Phase 2: Close the Knowledge Flow (閉環知識流與杜絕孤兒節點)

## 1. Analysis of Current Codebase State

**Database Schema (`lib/db/src/schema/`)**
- `l2_nodes.ts`: The schema currently uses `l2NodeTypeEnum` with options `["package", "module", "pcd"]`. There is no mechanism or type for `sys-uncategorized`.
- `l3_nodes.ts`: `l2NodeId` is an integer and is marked `.notNull()`. However, the client generates decisions locally without a valid `l2NodeId`, circumventing database strictness until sync.

**API Specification (`lib/api-spec/openapi.yaml`)**
- `L3NodeInput`: Crucially lacks `l2NodeId` validation entirely. It only requires `title` and `nodeType`.
- While `POST /l2-nodes/{id}/l3-nodes` infers the ID from the URL path, there is no generic ingress (e.g., bulk extraction upload) that strictly validates the `l2NodeId` format.

**Extraction Logic (`vscode-client` & `api-server`)**
- `vscode-client/src/TaskRunner.ts`: `writeExtractionResults()` hardcodes `l2_module_id: ""` into the frontmatter. All extracted L3 nodes are born as orphans.
- `api-server/src/routes/generate.ts`: Generates L2 and L3 via AI but does not utilize a Dual-Track approach (snippet vs bulk) or a Multi-stage Sieve Scoring System.

---

## 2. Implementation Goals & Tasks

### 📋 Dispatch Plan

**1. Database Schema Expert**
*   **Goal**: Ensure a systemic fallback for unassigned L3 decisions exists natively at the database level.
*   **Tasks**:
    *   **Action 1**: Update `l2NodeTypeEnum` in `lib/db/src/schema/l2_nodes.ts` to include `'sys-uncategorized'`, or add an `isSystem: boolean` column to `l2NodesTable`.
    *   **Action 2**: Alter DB queries/hooks (e.g., `artifacts/api-server/src/routes/projects.ts` project creation) to ensure every new project is initialized with an auto-created `sys-uncategorized` L2 Node.
    *   **Success Criterion**: Running DB migrations succeeds, and creating a new project automatically creates a `sys-uncategorized` L2 node.

**2. API Architect**
*   **Goal**: Enforce strict `l2NodeId` presence in API payloads and define the endpoints for the Sieve Model.
*   **Tasks**:
    *   **Action 1**: Update `lib/api-spec/openapi.yaml`. Ensure schemas related to L3 Node ingestion/syncing explicitly require `l2NodeId`. Ban empty strings (`""`) and nulls.
    *   **Action 2**: Define a new OpenAPI path (e.g., `POST /projects/{projectId}/extract/sieve`) for the backend to handle the Dual-Track extraction and categorization scoring.
    *   **Success Criterion**: Running `pnpm --filter @workspace/api-spec run codegen` completes successfully and emits updated Zod schemas.

**3. Backend Developer**
*   **Goal**: Implement Dual-Track Extraction and the Multi-stage Sieve Model scoring system.
*   **Tasks**:
    *   **Action 1**: In `@workspace/api-server`, implement Dual-Track logic:
        *   **Track A (Snippet/Strict)**: Immediately resolve `l2NodeId` based on source file. Use a configurable degradation chain (A2>A1>A3).
        *   **Track B (Bulk/Lenient)**: Fallback logic that automatically assigns `sys-uncategorized` as the `l2NodeId`.
    *   **Action 2**: Implement the Multi-stage Sieve Model for `sys-uncategorized` nodes using the formula `(GitHistory W1 + AST_Dep W2 + DirStructure W3 + SemanticVector W4)` to suggest the correct L2 module.
    *   **Success Criterion**: The new sieve endpoint successfully calculates a score array for unassigned decisions and returns suggested `l2NodeId` mappings.
