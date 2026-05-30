# Chat Participant: @docuvia

## Registration Details
- **ID**: `docuvia.assistant`
- **Name**: `docuvia`
- **Full Name**: `Docuvia Knowledge Graph`

## Handlers & Slash Commands

### `/explore`
- **Description**: Detect project type and suggest L1 tags for `.docuvia/l1_tags.yaml`
- **Flow**:

  #### 1. Keyword type override (fast path)
  If the user's prompt contains a recognised project-type token (`backend`, `frontend`, `library`, `data-science`, `cli`, `fullstack`, `monorepo`), Docuvia skips workspace detection and immediately matches the token against the built-in `L1_TEMPLATES` array. The matching template's tags are serialised to YAML and streamed to chat.

  > ⚠️ NOTE: `data-science` is present in `TYPE_TOKENS` (`ChatParticipant.ts:157`) but has no corresponding entry in `L1_TEMPLATES`. The `if (template)` guard never fires, so workspace detection is **not** skipped — this is a dead token and a known code gap (addressed in Round 2).

  #### 2. Workspace detection (default path)
  When no type keyword is found:
  1. Reads `README.md` and `package.json` from `workspaceFolders[0]` (first workspace only).
  2. Calls `detectProjectTypes()` — scores each of the 6 built-in templates by counting how many of the template's `keywords` appear in the README text (lowercased) or the `package.json` dependency names. Returns all templates with a non-zero score.
  3. If one or more templates match, calls `refineTagsWithLM()` — sends the detected template tags and the README excerpt to `request.model` (the user's currently selected Copilot model) for refinement. The AI is instructed to generate a comprehensive list (typically 10-25 tags) of YAML L1 tags.
  4. **Dynamic AI Analysis**: If no built-in template matches, it calls `generateTagsDynamically()` — sending all discovered `dependencies`/`devDependencies` and the README excerpt to `request.model` for zero-shot architectural analysis. The AI dynamically generates 10-25 custom L1 tags based on the domain (e.g. Data Science, IoT, Game Engine).
  5. If dynamic AI analysis also fails (e.g. API error), it falls back to an interactive clarification message asking the user to reply with `/explore <type>`.

  #### 3. Built-in L1 Templates (`L1_TEMPLATES`)

  | `projectType` | Label | Sample keywords |
  |---------------|-------|----------------|
  | `frontend` | Frontend Application | react, vue, angular, vite, next |
  | `backend` | Backend / API Server | express, fastify, nestjs, django |
  | `fullstack` | Fullstack Application | fullstack, trpc, remix, sveltekit |
  | `monorepo` | Monorepo / Multi-package | monorepo, turborepo, nx, pnpm-workspace |
  | `library` | Library / SDK / Package | library, sdk, npm, publish |
  | `cli` | CLI Tool | cli, commander, yargs, oclif |

  #### 4. Output Rendering and Accept Action
  The resulting YAML from either the static templates or dynamic AI analysis is parsed by `formatYamlAsTable()` and presented to the user as a clean Markdown table in the chat (showing Name and Description).
  
  After streaming the table, Docuvia renders a `stream.button` with the label **"Accept & Write to .docuvia/l1_tags.yaml"**. Clicking it invokes the internal command `docuvia.acceptL1Tags(yamlContent)`, which writes the raw YAML directly to `workspaceFolders[0]/.docuvia/l1_tags.yaml`.

  > ⚠️ **Single-workspace limitation**: `docuvia.acceptL1Tags` is hardcoded to write to `vscode.workspace.workspaceFolders?.[0]`, i.e. the **first** workspace folder. In a multi-root workspace with the second folder active, the tags will be written to the wrong project. The command is registered with `enablement: never` to prevent it from being invoked directly from the Command Palette.

### `/query`
- **Description**: Search local knowledge graph for matching modules and decisions
- **Flow**: Acts as the primary target for local search, or acts as the fallback display for cross-project search if `search.defaultView` is set to `chat`.

### `/extract`
- **Description**: Queue L3 decision extraction for the active file, specified file, or folder
- **Flow**: 
  1. **Target Resolution**: Uses the provided path, or the active editor's file. If neither is provided, defaults to the root of the first open workspace folder.
  2. **Directory Scanning**: If the target is a directory, recursively scans for files. It automatically ignores `.git`, `node_modules`, and `.docuvia`.
  3. **Pattern Filtering**: Applies `minimatch` against `docuvia.extraction.includePatterns` (configured in settings) to ensure only valid source code files are processed.
  4. **Task Queuing**: Reads the content of all matched files and queues individual L3 extraction tasks via `TaskRunner`.

### `/help`
- **Description**: Show available commands and usage
- **Flow**: Displays standard markdown instructions for using the Docuvia extension.
