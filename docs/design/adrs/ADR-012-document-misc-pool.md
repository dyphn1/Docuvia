# ADR-012: Document Misc Pool for Unaffiliated Documents

**Status:** Accepted

**Context:**  
Documents (PDF, Word, Markdown specs) uploaded to Docuvia often cannot be immediately attributed to a specific project. Forcing project assignment at upload time makes Docuvia unusable for organizations that upload company-wide specs or standards that span multiple projects.

**Decision:**  
`documents.projectId` is made nullable. Documents uploaded without a project ID enter the **misc pool** (`projectId = null`, `status = 'unaffiliated'`). The pipeline extracts text content and computes a `contentHash` (SHA-256) at upload time, but does NOT run L1/L2/L3 generation and does NOT create review tasks.

When a project manager manually associates a misc pool document with a project (via Web UI), the system:

1. Sets `documents.projectId` to the target project.
2. Uses `contentHash` to check if this document has already been processed for this project — avoids duplicate generate runs.
3. Promotes the document into the project's generate pipeline on next run.

**Consequences:**

- ✅ Zero-friction document ingestion — upload first, classify later
- ✅ Company-wide specs can be associated with multiple projects over time
- ✅ No wasted LLM calls on documents not yet ready for knowledge extraction
- ⚠️ `documents` schema change: `projectId` must change from `NOT NULL` to nullable; add `contentHash text`, `affiliatedAt timestamp` columns
- ⚠️ Web UI needs a “Misc Pool” view and a “Associate with Project” action
