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
  3. If one or more templates match, calls `refineTagsWithLM()` — sends the detected template tags and the README excerpt to `vscode.lm` (`copilot/gpt-4o`) for a single refinement pass, producing a final YAML string.
  4. If no template matches, falls back to an interactive clarification message listing the 6 project types and asking the user to reply with `/explore <type>`.

  #### 3. Built-in L1 Templates (`L1_TEMPLATES`)

  | `projectType` | Label | Sample keywords |
  |---------------|-------|----------------|
  | `frontend` | Frontend Application | react, vue, angular, vite, next |
  | `backend` | Backend / API Server | express, fastify, nestjs, django |
  | `fullstack` | Fullstack Application | fullstack, trpc, remix, sveltekit |
  | `monorepo` | Monorepo / Multi-package | monorepo, turborepo, nx, pnpm-workspace |
  | `library` | Library / SDK / Package | library, sdk, npm, publish |
  | `cli` | CLI Tool | cli, commander, yargs, oclif |

  #### 4. Accept button (`docuvia.acceptL1Tags` internal command)
  After streaming the suggested YAML, Docuvia renders a `stream.button` with the label **"Accept & Write to .docuvia/l1_tags.yaml"**. Clicking it invokes the internal command `docuvia.acceptL1Tags(yamlContent)`, which writes the YAML directly to `workspaceFolders[0]/.docuvia/l1_tags.yaml`.

  > ⚠️ **Single-workspace limitation**: `docuvia.acceptL1Tags` is hardcoded to write to `vscode.workspace.workspaceFolders?.[0]`, i.e. the **first** workspace folder. In a multi-root workspace with the second folder active, the tags will be written to the wrong project. The command is registered with `enablement: never` to prevent it from being invoked directly from the Command Palette.

### `/query`
- **Description**: Search local knowledge graph for matching modules and decisions
- **Flow**: Acts as the primary target for local search, or acts as the fallback display for cross-project search if `search.defaultView` is set to `chat`.

### `/extract`
- **Description**: Queue L3 decision extraction for the active or specified file
- **Flow**: Mirrors `docuvia.runExtraction` but triggered conversationally.

### `/help`
- **Description**: Show available commands and usage
- **Flow**: Displays standard markdown instructions for using the Docuvia extension.
