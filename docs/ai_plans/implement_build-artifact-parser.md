# Implementation Plan: Build Artifact Parser (Phase 2 Completion)

> **Feature:** Build Artifact Parser — structured extraction from linker map files, UEFI firmware volumes (FV/FD), and compile logs  
> **Phase:** 2 — Input Layer (closes the final Phase 2 gap)  
> **Priority:** High — Phase 2 is the core ingestion pipeline. This is the only remaining gap preventing 100% Phase 2 completion.  
> **Estimated Impact:** All `.map`, `.fv`, `.fd`, `.log` artifacts will be parsed into structured, LLM-optimized text before storage, dramatically improving L1→L2→L3 generation quality for embedded/firmware projects.

---

## 1. Goals

1. Replace the no-op `build_artifact` text passthrough in `extractText()` with intelligent structured parsing.
2. Support four artifact subtypes:
   - **Linker Map** (`.map`) — memory layout, section sizes, symbol table
   - **Firmware Volume** (`.fv`) — UEFI INF module list, FV attributes, GUID-to-module table
   - **Flash Descriptor** (`.fd`) — flash region layout, FV references, base addresses
   - **Compile Log** (`.log`, `.txt` with build output heuristics) — per-module error/warning counts, build configuration
3. Format extracted data as human-readable, LLM-optimized Markdown blocks that integrate cleanly into the existing `documentContext` injected in `generate.ts`.
4. Extend upload middleware to accept `.log` files.
5. (Optional) Add a dedicated `POST /projects/:id/ingest/build-artifact` API endpoint with explicit `artifactSubtype` override — allows callers to force a parsing mode when the subtype cannot be reliably auto-detected from the file extension alone.

---

## 2. Current State Analysis

| Layer | Status | Detail |
|---|---|---|
| `documentsTable` DB schema | ✅ Ready | `build_artifact` enum value already exists |
| `/ingest/document` route | ✅ Ready | Already stores `build_artifact` docs |
| `/ingest/document/upload` route | ✅ Ready | Multer accepts `.map`, `.fv`, `.fd` |
| `detectDocType()` | ✅ Ready | Maps `.map`, `.fv`, `.fd` → `build_artifact` |
| `extractText()` — `build_artifact` case | ❌ Stub | Returns raw `buffer.toString("utf-8")` with no parsing |
| `.log` file support | ❌ Missing | Not in `ALLOWED_EXTENSIONS` or `detectDocType` |
| Dedicated build artifact endpoint | ❌ Missing | No `artifactSubtype` override field in any endpoint |

---

## 3. Architecture

```
Upload (.map / .fv / .fd / .log)
  │
  ▼
detectDocType(filename) → "build_artifact"
  │
  ▼
extractText(buffer, "build_artifact", filename)
  │
  ▼
build-artifact-parser.ts
  ├── detectSubtype(filename, content) → "map" | "fv" | "fd" | "compile-log"
  ├── parseMapFile(content) → ParsedBuildArtifact
  ├── parseFvFile(content) → ParsedBuildArtifact
  ├── parseFdFile(content) → ParsedBuildArtifact
  ├── parseCompileLog(content) → ParsedBuildArtifact
  └── formatAsBuildArtifactText(parsed) → structured Markdown string
  │
  ▼
documentsTable.content = structured Markdown
  │
  ▼
generate.ts → documentContext (first 800 chars per doc injected into LLM prompts)
```

---

## 4. Files to Create / Modify

### 4.1 NEW: `artifacts/api-server/src/lib/build-artifact-parser.ts`

**Purpose:** Dedicated parser module for all build artifact subtypes.

**Exported types:**

```typescript
export type BuildArtifactSubtype = "map" | "fv" | "fd" | "compile-log";

export interface MemorySection {
  name: string;       // e.g. ".text", ".data", "FvRecover"
  address?: string;   // e.g. "0x00000000"
  size?: number;      // bytes
  sizeHex?: string;   // e.g. "0x12345"
}

export interface FirmwareModule {
  name: string;       // e.g. "DxeMain", "PcdDxe"
  guid?: string;      // optional GUID
  infPath?: string;   // e.g. "MdeModulePkg/Core/Dxe/DxeMain.inf"
  type?: string;      // e.g. "DRIVER", "APPLICATION"
}

export interface BuildDiagnostic {
  severity: "error" | "warning";
  module?: string;
  file?: string;
  line?: number;
  message: string;
}

export interface ParsedBuildArtifact {
  subtype: BuildArtifactSubtype;
  filename: string;
  sections: MemorySection[];
  modules: FirmwareModule[];
  diagnostics: BuildDiagnostic[];
  metadata: Record<string, string>;   // free-form key-value pairs (BaseAddress, FvSize, etc.)
  summary: string;                    // 1-2 sentence human summary
}
```

**Exported functions:**

```typescript
export function detectSubtype(filename: string, content: string): BuildArtifactSubtype
export function parseMapFile(content: string, filename: string): ParsedBuildArtifact
export function parseFvFile(content: string, filename: string): ParsedBuildArtifact
export function parseFdFile(content: string, filename: string): ParsedBuildArtifact
export function parseCompileLog(content: string, filename: string): ParsedBuildArtifact
export function formatAsBuildArtifactText(parsed: ParsedBuildArtifact): string
export function extractBuildArtifactText(content: string, filename: string): string  // main entry point
```

---

#### 4.1.1 `detectSubtype(filename, content)`

Priority order:
1. `.map` extension → `"map"`
2. `.fv` extension → `"fv"`
3. `.fd` extension → `"fd"`
4. Content heuristic: `DEFINE FV_NAMESPACE` or `[FV.` pattern → `"fv"`
5. Content heuristic: `[FD.` pattern → `"fd"`
6. Content heuristic: many `error:` or `warning:` lines → `"compile-log"`
7. Default → `"compile-log"`

---

#### 4.1.2 `parseMapFile(content, filename)`

**Target formats:**
- **GCC ld map**: `.section 0xADDRESS SIZE`
- **MSVC map**: `Address Publics by Value Rva+Base` table
- **EDK2 map**: module address table with GUID column

**Parsing logic:**
```
GCC ld linker map pattern:
  /^([.\w]+)\s+(0x[\da-f]+)\s+(0x[\da-f]+)/gm
  → name = group 1, address = group 2, sizeHex = group 3

MSVC map section pattern:
  /^([0-9A-Fa-f]{4}):([0-9A-Fa-f]{8})\s+([.\w@?$]+)\s+([0-9A-Fa-f]{8})/gm
  → Extract public symbol table

EDK2 table pattern (tab/space delimited with columns):
  Look for lines containing GUID-like patterns: /[0-9a-f]{8}-[0-9a-f]{4}-/
```

**Output sections:** top 20 largest sections by size  
**Output modules:** any module names inferred from `.o` file paths or symbol prefixes  
**Summary:** `"Linker map with N sections. Largest: .text (X KB), .rodata (Y KB). Total image size: Z KB."`

---

#### 4.1.3 `parseFvFile(content, filename)`

**Target format (EDK2 INF-like DSC syntax):**
```ini
[FV.FvMain]
FvAlignment        = 16
APRIORI DXE {
  INF  MdeModulePkg/Core/Dxe/DxeMain.inf
  INF  MdeModulePkg/Universal/PCD/Dxe/PcdDxe.inf
}
INF  IntelFrameworkModulePkg/Core/Dxe/DxeIplX64Peim/DxeIplX64Peim.inf
FILE FREEFORM = PCD(gTokenSpaceGuid.PcdVariable) {
  SECTION DATA = $(OUTPUT_DIR)/varstore.efi
}
```

**Parsing logic:**
```
FV section header: /^\[FV\.(\w+)\]/gm → name
Metadata: /^(\w+)\s*=\s*(.+)$/gm within FV block → metadata
INF lines: /^\s+INF\s+(.+\.inf)/gm → infPath, derive module name from last path segment
FILE lines: /^\s+FILE\s+(\w+)\s*=\s*([A-Z0-9-]+)/gm → GUID + type
```

**Output modules:** all INF files listed  
**Output metadata:** FvAlignment, FvSize, BaseAddress if present  
**Summary:** `"Firmware Volume [name] with N modules (DXE drivers). Apriori: M modules."`

---

#### 4.1.4 `parseFdFile(content, filename)`

**Target format (EDK2 FDF syntax):**
```ini
[FD.Platform]
BaseAddress   = 0xFF800000|gPlatformTokenSpaceGuid.PcdFlashAreaBaseAddress
Size          = 0x00800000|gPlatformTokenSpaceGuid.PcdFlashAreaSize
ErasePolarity = 1

0x00000000|0x00060000
gPlatformTokenSpaceGuid.PcdFlashNvStorage...
FILE = $(OUTPUT_DIRECTORY)/FV/FvMain.fv

0x00060000|0x00200000
FILE = $(OUTPUT_DIRECTORY)/FV/FvRecover.fv
```

**Parsing logic:**
```
FD header: /^\[FD\.(\w+)\]/gm → name
BaseAddress: /^BaseAddress\s*=\s*(0x[\da-fA-F]+)/m
Size: /^Size\s*=\s*(0x[\da-fA-F]+)/m
Regions: /^(0x[\da-fA-F]+)\|(0x[\da-fA-F]+)/gm → offset, size
FV references in regions: /FILE\s*=\s*.+\/(FV\w+)\.fv/gm → FV name
```

**Output sections:** each flash region as a MemorySection  
**Output metadata:** FD name, BaseAddress, total Size  
**Summary:** `"Flash Descriptor [name]: BaseAddress=0x..., Size=X MB. N flash regions (FvMain, FvRecover, ...)."`

---

#### 4.1.5 `parseCompileLog(content, filename)`

**Common patterns:**
- **GCC/Clang**: `path/to/file.c:42:10: error: undeclared identifier 'foo'`
- **MSVC**: `path\to\file.cpp(42): error C2065: 'foo': undeclared identifier`
- **EDK2 build**: `Build Successful.` / `Build Failed. N error(s)`
- **Make**: `make[N]: *** [target] Error 1`

**Parsing logic:**
```typescript
// GCC pattern
/^(.+?):(\d+):\d+:\s*(error|warning):\s*(.+)$/gm
// MSVC pattern
/^(.+?)\((\d+)\):\s*(error|warning)\s+\w+:\s*(.+)$/gm
// Extract module from file path (last directory component)
```

**Output diagnostics:** all errors and warnings with file/line  
**Metadata:** `{ totalErrors: N, totalWarnings: N, buildStatus: "success"|"failed"|"unknown" }`  
**Summary:** `"Build log: N errors, N warnings across N modules. Status: [buildStatus]."`

---

#### 4.1.6 `formatAsBuildArtifactText(parsed)`

Returns a structured Markdown string optimized for LLM consumption (fits within the 800-char slice in `generate.ts` for the most critical summary):

```markdown
# Build Artifact: [SUBTYPE] — [filename]

## Summary
[1-2 sentence summary]

## Metadata
- BaseAddress: 0x...
- TotalSize: X KB
- BuildStatus: success

## Memory Sections / Flash Regions (top 10)
| Name | Address | Size |
|------|---------|------|
| .text | 0x00001000 | 48 KB |

## Firmware Modules (N total)
- DxeMain (MdeModulePkg/Core/Dxe/DxeMain.inf)
- PcdDxe (MdeModulePkg/Universal/PCD/Dxe/PcdDxe.inf)
[...up to 20 modules]

## Build Diagnostics
### Errors (N)
- [file.c:42] undeclared identifier 'foo'

### Warnings (N)
- [module/file.c:10] implicit function declaration
```

---

### 4.2 MODIFY: `artifacts/api-server/src/lib/document-parser.ts`

**Change 1:** Add optional `filename` parameter to `extractText()`:

```typescript
// Before:
export async function extractText(buffer: Buffer, docType: SupportedDocType): Promise<string>

// After:
export async function extractText(
  buffer: Buffer,
  docType: SupportedDocType,
  filename?: string
): Promise<string>
```

**Change 2:** In the `build_artifact` case, call the new parser:

```typescript
case "build_artifact":
  return extractBuildArtifactText(buffer.toString("utf-8"), filename ?? "artifact");
```

**Change 3:** Add `.log` to the extension map in `detectDocType()`:

```typescript
const map: Record<string, SupportedDocType> = {
  // ...existing...
  log: "build_artifact",
};
```

---

### 4.3 MODIFY: `artifacts/api-server/src/middlewares/upload.ts`

Add `.log` to `ALLOWED_EXTENSIONS`:

```typescript
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "pptx", "txt", "md", "map", "fv", "fd", "log"]);
```

---

### 4.4 MODIFY: `artifacts/api-server/src/routes/ingest.ts`

**Change 1:** In the `/document/upload` handler, pass `originalname` to `extractText()`:

```typescript
// Before:
content = await extractText(buffer, docType);

// After:
content = await extractText(buffer, docType, originalname);
```

**Change 2 (Optional — Dedicated Endpoint):** Add `POST /projects/:id/ingest/build-artifact` route that:
- Accepts `{ filename, content, artifactSubtype?: "map"|"fv"|"fd"|"compile-log" }` in JSON body
- Calls `extractBuildArtifactText(content, filename)` to parse
- Stores result in `documentsTable` with `docType = "build_artifact"`
- Returns stored document record

This endpoint is more explicit than the generic `/ingest/document` and allows API callers to bypass auto-detection.

---

### 4.5 MODIFY: `lib/api-spec/openapi.yaml` (Optional Dedicated Endpoint)

**Add schema:**
```yaml
BuildArtifactIngestInput:
  type: object
  required: [filename, content]
  properties:
    filename:
      type: string
      example: "firmware.map"
    content:
      type: string
      description: Raw artifact content (text)
    artifactSubtype:
      type: string
      enum: [map, fv, fd, compile-log]
      description: Force artifact subtype detection (optional — auto-detected from filename if omitted)

**Add path:**
/projects/{id}/ingest/build-artifact:
  post:
    operationId: ingestBuildArtifact
    tags: [ingest]
    summary: Ingest and parse a build artifact (map, FV, FD, compile log)
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/BuildArtifactIngestInput"
    responses:
      "201":
        description: Parsed and stored document
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Document"
      "404":
        description: Project not found
```

---

### 4.6 NO CHANGES NEEDED

- `lib/db/src/schema/documents.ts` — `build_artifact` enum value already present
- `artifacts/kg-engine/` — No frontend changes needed; build artifacts appear in the Documents list with `docType: "build_artifact"` and can be ingested via the existing upload UI
- `artifacts/api-server/src/routes/generate.ts` — Documents are already fetched and injected as `documentContext`; no change needed

---

## 5. Step-by-Step Implementation

### Step 1: Create `build-artifact-parser.ts`

1. Create `artifacts/api-server/src/lib/build-artifact-parser.ts`
2. Implement the types: `BuildArtifactSubtype`, `MemorySection`, `FirmwareModule`, `BuildDiagnostic`, `ParsedBuildArtifact`
3. Implement `detectSubtype(filename, content)` — extension-first, then content heuristics
4. Implement `parseMapFile(content, filename)`:
   - Try GCC ld format regex first
   - Try MSVC public symbols table format
   - Try EDK2 GUID table format
   - Collect top 20 sections by size
   - Generate summary
5. Implement `parseFvFile(content, filename)`:
   - Match `[FV.Name]` headers
   - Extract INF paths → derive module names
   - Collect metadata (FvAlignment, FvSize)
6. Implement `parseFdFile(content, filename)`:
   - Match `[FD.Name]` headers
   - Extract BaseAddress, Size
   - Match `0xOFFSET|0xSIZE` region blocks + FV FILE references
7. Implement `parseCompileLog(content, filename)`:
   - Match GCC/Clang and MSVC error/warning patterns
   - Determine build status from "Build Successful"/"Build Failed" lines
8. Implement `formatAsBuildArtifactText(parsed)`:
   - Generate Markdown with Summary section first (most important for LLM)
   - Cap sections/modules/diagnostics lists to keep output manageable
9. Implement `extractBuildArtifactText(content, filename)` — orchestrator

### Step 2: Update `document-parser.ts`

1. Import `extractBuildArtifactText` from `./build-artifact-parser.js`
2. Add `log: "build_artifact"` to the `detectDocType()` extension map
3. Add `filename?: string` parameter to `extractText()`
4. Replace the `build_artifact` case: `return extractBuildArtifactText(buffer.toString("utf-8"), filename ?? "artifact")`

### Step 3: Update `upload.ts`

1. Add `"log"` to `ALLOWED_EXTENSIONS`

### Step 4: Update `ingest.ts`

1. In the `/document/upload` handler, pass `originalname` as third argument to `extractText(buffer, docType, originalname)`
2. (Optional) Add the dedicated `/ingest/build-artifact` POST route

### Step 5: Update `openapi.yaml` (if dedicated endpoint chosen)

1. Add `BuildArtifactIngestInput` schema under `components/schemas`
2. Add `POST /projects/{id}/ingest/build-artifact` path
3. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate Zod validators and React Query hooks

### Step 6: Verify

```bash
# Typecheck all packages
pnpm run typecheck

# Build
pnpm run build

# (If openapi.yaml was changed)
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

---

## 6. Affected Packages

| Package | Change Type |
|---|---|
| `artifacts/api-server` | New file + 3 file modifications |
| `lib/api-spec` | Modified (if dedicated endpoint added) |
| `lib/api-zod` | Regenerated (if OpenAPI changed) |
| `lib/api-client-react` | Regenerated (if OpenAPI changed) |

---

## 7. Design Decisions & Rationale

| Decision | Rationale |
|---|---|
| **Pure text extraction (no binary parsing)** | `.map`, `.fv`, `.fd` files targeted here are text-format artifacts (EDK2/UEFI build system outputs), not binary firmware images. Binary formats are out of scope. |
| **Regex-based parsing (no external deps)** | Avoids adding new npm dependencies. The patterns are well-defined and stable for the target file formats. |
| **Markdown output format** | Aligns with the LLM-optimized context already used by the `documentContext` in `generate.ts`. The summary line appears in the first 800 chars. |
| **Summary-first output** | `generate.ts` slices document content to `slice(0, 800)`. Putting the summary first ensures the most value-dense information reaches the LLM even with truncation. |
| **Dedicated endpoint optional** | The generic `/ingest/document` path already works. The dedicated endpoint adds explicit `artifactSubtype` override which is convenient but not critical. |
| **No DB schema changes** | `documentsTable` already has `build_artifact` enum value and a `text` content column — perfectly suited for storing the formatted Markdown output. |

---

## 8. Test Cases (Manual Verification)

After implementation, verify with these scenarios:

1. Upload a sample GCC linker `.map` file → document stored, content shows sections table in Markdown
2. Upload a sample UEFI `.fv` file → document stored, content shows INF module list
3. Upload a sample UEFI `.fd` file → document stored, content shows flash regions
4. Upload a `.log` file with GCC error lines → document stored, content shows error/warning table
5. Run `POST /api/projects/:id/generate` on a project with build artifact documents → generation uses structured content
6. Verify via `GET /api/projects/:id/documents` that `docType = "build_artifact"` appears correctly

---

## 9. Out of Scope

- Binary firmware image parsing (`.bin`, `.efi`, `.rom`) — binary formats require specialized tools
- Real-time build monitoring / CI integration — that is Phase 7 scope (Incremental update)
- Frontend UI changes for build artifact visualization — the existing Documents page handles display

---

_Plan created: 2026-05-12 | Analyzer: Requirement Analyzer Agent_
