# Implementation Plan: Document Parsers (PDF / DOCX / PPTX)

> Created: 2026-05-12  
> Author: Requirement Analyzer  
> Status: Ready for Backend Developer

---

## 1. Implementation Goals

Enable real binary document ingestion for the Docuvia platform by:

1. Adding a new multipart file-upload endpoint `POST /projects/:id/ingest/document/upload`
2. Implementing server-side text extraction for PDF, DOCX, and PPTX files
3. Updating the OpenAPI spec to declare the new multipart endpoint
4. Keeping the existing JSON endpoint (`POST /projects/:id/ingest/document`) fully backward-compatible for MD/TXT

---

## 2. Current State Analysis

### Existing Implementation (`artifacts/api-server/src/routes/ingest.ts`)

The current `POST /projects/:id/ingest/document` route:
- Accepts a JSON body: `{ filename: string, content: string, docType?: enum }`
- Stores `content` verbatim into `documentsTable.content` (text column)
- **Problem**: Binary files (PDF/DOCX/PPTX) cannot be meaningfully sent as raw JSON strings. Clients have no way to upload actual binary files.
- The `docType` enum already includes `pdf`, `docx`, `pptx` — schema is ready, parser is missing.

### DB Schema (`lib/db/src/schema/documents.ts`)

```ts
export const documentTypeEnum = pgEnum("document_type", ["markdown", "txt", "pdf", "docx", "pptx", "build_artifact"]);

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  docType: documentTypeEnum("doc_type").notNull().default("markdown"),
  content: text("content").notNull(),   // stores extracted plain text
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**No DB schema changes are required** — `content` column already stores extracted text.

### OpenAPI Spec (`lib/api-spec/openapi.yaml`)

The existing `DocumentIngestInput` schema requires `content: string`. A new multipart endpoint must be added under the `ingest` tag.

---

## 3. Approach / Methodology

### Design Decision: Add New Multipart Endpoint (Non-Breaking)

Add a dedicated `POST /projects/:id/ingest/document/upload` endpoint that:
- Accepts `multipart/form-data` with a single `file` field (binary upload)
- Detects document type from file extension
- Extracts plain text via a format-specific parser library
- Stores extracted text in `documentsTable.content` (same schema as before)
- Returns the same `Document` response shape as the existing endpoint

The existing JSON endpoint remains **unchanged** — no breaking changes.

### Parser Library Selection

| Format | Library | Rationale |
|--------|---------|-----------|
| PDF | `pdf-parse` (npm) | Well-maintained, pure JS, no native deps |
| DOCX | `mammoth` (npm) | Extracts clean text from Word documents |
| PPTX | `officeparser` (npm) | Handles PPTX text extraction without native binaries |
| MD / TXT | Built-in string passthrough | No parsing needed |

All three libraries are pure-JS / pure-Node — no native binaries required, compatible with the ESM monorepo.

### File Upload: `multer` (memory storage)

Use `multer` with `memoryStorage()` so the uploaded file buffer is available at `req.file.buffer`. Max file size: **10 MB**. No disk writes.

---

## 4. Detailed Implementation Steps

### Step 1: Install Dependencies

In `artifacts/api-server/package.json`, add to `dependencies`:
```json
"multer": "^1.4.5-lts.2",
"pdf-parse": "^1.1.1",
"mammoth": "^1.8.0",
"officeparser": "^4.1.2"
```

Add to `devDependencies`:
```json
"@types/multer": "^1.4.12",
"@types/pdf-parse": "^1.1.4"
```

> Run `pnpm install` from workspace root after modifying package.json.

### Step 2: Create Parser Utility Module

Create `artifacts/api-server/src/lib/document-parser.ts`:

```ts
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import officeParser from "officeparser";
import { promisify } from "util";

const parseOffice = promisify(officeParser.parseOfficeAsync.bind(officeParser));

export type SupportedDocType = "markdown" | "txt" | "pdf" | "docx" | "pptx" | "build_artifact";

/**
 * Detect doc type from file extension.
 */
export function detectDocType(filename: string): SupportedDocType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, SupportedDocType> = {
    md: "markdown",
    txt: "txt",
    pdf: "pdf",
    docx: "docx",
    pptx: "pptx",
    map: "build_artifact",
    fv: "build_artifact",
    fd: "build_artifact",
  };
  return map[ext] ?? "txt";
}

/**
 * Extract plain text from a file buffer.
 * @param buffer  Raw file bytes
 * @param docType Detected document type
 * @returns Extracted plain text string
 */
export async function extractText(buffer: Buffer, docType: SupportedDocType): Promise<string> {
  switch (docType) {
    case "pdf": {
      const result = await pdfParse(buffer);
      return result.text.trim();
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    }
    case "pptx": {
      const text = await parseOffice(buffer) as string;
      return text.trim();
    }
    case "markdown":
    case "txt":
    case "build_artifact":
    default:
      // For text-based formats, assume buffer is UTF-8 text
      return buffer.toString("utf-8").trim();
  }
}
```

### Step 3: Add Multer Middleware Helper

Create `artifacts/api-server/src/middlewares/upload.ts`:

```ts
import multer from "multer";

const ALLOWED_MIMETYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/octet-stream", // fallback for unknown
]);

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    // Accept by mimetype or by extension (.md files may come as text/plain)
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
    const allowedExts = new Set(["pdf", "docx", "pptx", "txt", "md", "map", "fv", "fd"]);
    if (ALLOWED_MIMETYPES.has(file.mimetype) || allowedExts.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype} (.${ext})`));
    }
  },
});
```

### Step 4: Add Upload Route Handler

In `artifacts/api-server/src/routes/ingest.ts`, add the following **after** the existing `router.post("/projects/:id/ingest/document", ...)` handler:

```ts
import { documentUpload } from "../middlewares/upload.js";
import { detectDocType, extractText } from "../lib/document-parser.js";

router.post(
  "/projects/:id/ingest/document/upload",
  documentUpload.single("file"),
  async (req, res) => {
    const projectId = Number(req.params.id);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use multipart/form-data with field name 'file'." });
    }

    const { originalname, buffer } = req.file;
    const docType = detectDocType(originalname);

    let content: string;
    try {
      content = await extractText(buffer, docType);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(422).json({ error: `Failed to parse document: ${msg}` });
    }

    if (!content || content.length === 0) {
      return res.status(422).json({ error: "Extracted content is empty. The document may be encrypted or contain only images." });
    }

    const [doc] = await db.insert(documentsTable).values({
      projectId,
      filename: originalname,
      docType,
      content,
    }).returning();

    await db.insert(activityLogTable).values({
      type: "document",
      description: `Ingested document "${originalname}" (${docType}) — ${content.length} chars extracted`,
      projectId,
    });

    res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
  }
);
```

### Step 5: Register Route Order (Important)

The upload route `/projects/:id/ingest/document/upload` **must be registered BEFORE** the existing `/projects/:id/ingest/document` route so Express matches `/upload` before the plain POST on the same path prefix. Verify import order in `artifacts/api-server/src/routes/ingest.ts`.

### Step 6: Update OpenAPI Spec

In `lib/api-spec/openapi.yaml`, add the new endpoint immediately after the existing `/projects/{id}/ingest/document` block (around line 284):

```yaml
  /projects/{id}/ingest/document/upload:
    post:
      operationId: uploadDocument
      tags: [ingest]
      summary: Upload and ingest a binary document (PDF, DOCX, PPTX) — text is extracted server-side
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
                  description: Document file (PDF, DOCX, PPTX, TXT, MD) — max 10 MB
      responses:
        "201":
          description: Document stored with extracted text content
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Document"
        "400":
          description: No file uploaded or invalid request
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "422":
          description: File could not be parsed (encrypted, image-only, corrupt)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

### Step 7: Run Orval Code Generation

After updating OpenAPI spec, regenerate Zod validators and React Query hooks:

```bash
pnpm --filter @workspace/api-spec run generate
```

### Step 8: Build Verification

```bash
pnpm --filter @workspace/api-server run build
```

---

## 5. Implementation Details

### Affected Files

| File | Change Type |
|------|-------------|
| `artifacts/api-server/package.json` | Add `multer`, `pdf-parse`, `mammoth`, `officeparser` deps |
| `artifacts/api-server/src/lib/document-parser.ts` | **CREATE** — text extraction utility |
| `artifacts/api-server/src/middlewares/upload.ts` | **CREATE** — multer middleware |
| `artifacts/api-server/src/routes/ingest.ts` | **MODIFY** — add upload route, import new modules |
| `lib/api-spec/openapi.yaml` | **MODIFY** — add multipart endpoint |
| `lib/api-zod/src/generated/` | Auto-generated via Orval after spec update |
| `lib/api-client-react/src/generated/` | Auto-generated via Orval after spec update |

### Affected pnpm Workspace Packages

- `@workspace/api-server` (primary)
- `@workspace/api-spec` (spec update + Orval trigger)
- `@workspace/api-zod` (regenerated)
- `@workspace/api-client-react` (regenerated)

### No Changes Required

- `lib/db/` — schema is already correct
- `artifacts/kg-engine/` — frontend uses generated hooks; auto-updates after Orval regen
- Any existing tests against the JSON endpoint — backward compatible

---

## 6. Error Handling Strategy

| Scenario | HTTP Status | Response |
|----------|-------------|----------|
| No file in request | 400 | `{ error: "No file uploaded..." }` |
| Unsupported file type | 400 | multer fileFilter error |
| File too large (>10 MB) | 413 | multer limit error (propagated by Express) |
| Parser throws (corrupt/encrypted) | 422 | `{ error: "Failed to parse document: ..." }` |
| Empty extraction result | 422 | `{ error: "Extracted content is empty..." }` |
| Project not found | 404 | `{ error: "Project not found" }` |

---

## 7. Security Considerations

- **File size limit**: 10 MB hard cap via multer to prevent DoS
- **MIME type + extension allowlist**: Only known document types accepted
- **Memory storage**: Files are never written to disk — no path traversal risk
- **Content stored as plain text**: Binary data is never stored in DB; extracted text only
- **No user-controlled filenames used in filesystem operations**: `originalname` is stored as metadata only

---

## 8. Testing Verification

After implementation, verify with:

```bash
# Upload a PDF
curl -X POST http://localhost:5000/api/projects/1/ingest/document/upload \
  -F "file=@sample.pdf"

# Upload a DOCX
curl -X POST http://localhost:5000/api/projects/1/ingest/document/upload \
  -F "file=@sample.docx"

# Upload a PPTX
curl -X POST http://localhost:5000/api/projects/1/ingest/document/upload \
  -F "file=@sample.pptx"

# Verify stored content
curl http://localhost:5000/api/projects/1/documents
```

Expected: Each returns `201` with `{ id, projectId, filename, docType, content: "<extracted text>", createdAt }`.

---

## 9. Architecture Note

This implementation follows the **extract-then-store** pattern: binary → text → knowledge graph. The extracted plain text stored in `documentsTable.content` becomes the input for the existing `POST /projects/:id/generate` pipeline (L1→L2→L3), enabling AI knowledge extraction from real documents without any pipeline changes.
