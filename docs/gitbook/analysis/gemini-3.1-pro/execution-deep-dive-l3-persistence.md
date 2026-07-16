# Docuvia2 L3 Decision Persistence (Wire 2) In-Depth Implementation & Architecture Analysis

> **Context**: In-depth technical analysis for "Priority 1: L3 Decision Persistence" in the Phase 1 execution strategy.
> **Date**: 2026-07-16
> **Status**: Independent Analysis Report

---

## 1. Problem Background (The Missing Wire)

In the current system state, the `analyze <targetPath>` command successfully calls the model via the LLM-002 CLIProxyAPI and extracts L3 architectural decisions and rules, but ultimately only prints them to the terminal using `ui.info()`.
Meanwhile, the `l3_nodes` SQLite table and `l3-nodes-repo.ts` are ready, and the `sync` command already has the pipeline to push L3 to the remote.
**Core Disconnect**: We are missing the final mile of transforming and writing the LLM output to the local `l3_nodes` table.

## 2. Data Model & Schema Mapping

To write the unstructured or semi-structured LLM output into a relational database, it must strictly align with the `l3_nodes` schema:

- **`l2_node_id` (Relational Binding)**: L3 is generated based on a specific L2 node (e.g., class, function). During implementation, the extraction engine needs to return the associated L2 Symbol Name or directly return the corresponding UUID. If the L2 node is deleted during an incremental update, L3 should remain dangling (or marked as orphaned) and should not be cascadingly deleted. This aligns with the "L3 is accumulative" design.
- **`title` and `content`**: The LLM output needs to be structured. It is recommended to enforce a JSON return in the Prompt phase, containing a short title (`title`) and detailed decision content (`content`).
- **`content_hash` (Deduplication Mechanism)**: Hash the L3 content using `crypto.createHash('sha256')`. Check for existing records with the same hash before writing; this is the key defense to ensure "repeated Analyze on the same target does not generate infinite redundant data".
- **`validity_status` (Lifecycle)**: Upon initial write, the status should be set to `pending_verification` or `garbage` (as defined in the GRPH-002 phase), awaiting subsequent Task Verifier or human confirmation.

## 3. Implementation Path

1. **Expand Analyze Workflow**:
   Modify `lib/ui-core/src/workflows/analyze/analyze-workflow.ts`. Instead of exiting directly after the LLM returns the parsed result, proceed to save it.
2. **Dependency Injection of `l3NodesRepo`**:
   Inject `L3NodesRepo` into the Workflow. Since `L3NodesRepo` is deliberately declared as Read-Only (no insert method) currently, we need to:
   - Implement an `insertDecision(decision: Omit<L3Node, 'id'>): Promise<string>` method in `l3-nodes-repo.ts`.
3. **Transaction & Consistency**:
   When writing L3, it should be wrapped in a single database Transaction. This ensures that if the L3 analysis contains multiple rules, they are either all written or all fail.

## 4. Edge Cases & Potential Risks

- **Invalid L2 Mapping Due to LLM Hallucination**: If the LLM-generated decision refers to a non-existent source code symbol.
  - **Defense**: Before writing to `l3_nodes`, it must join `l2_nodes` to confirm the symbol exists. If it does not exist, the `l2_node_id` of the L3 record is set to null, but its `content` is retained as global knowledge.
- **Repeated Extraction (Idempotency)**:
  - If `analyze` is executed repeatedly on the same file, duplicate writes must be blocked via `content_hash` (UPSERT logic).
- **String Encoding Anomalies**: If the LLM outputs abnormal Markdown control characters, writing to SQLite paired with FTS5 for full-text search indexing (`l3_nodes_fts`) might trigger errors.
  - **Defense**: It must undergo strict validation and sanitization of invisible characters via Zod before being passed to the Repo layer.
