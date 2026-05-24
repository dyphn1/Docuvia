# Chat Participant: @docuvia

## Registration Details
- **ID**: `docuvia.assistant`
- **Name**: `docuvia`
- **Full Name**: `Docuvia Knowledge Graph`

## Handlers & Slash Commands

### `/explore`
- **Description**: Detect project type and suggest L1 tags for `.docuvia/l1_tags.yaml`
- **Flow**: (Refer to `ChatParticipant.ts` for logic; usually triggers LLM analysis of package manager files).

### `/query`
- **Description**: Search local knowledge graph for matching modules and decisions
- **Flow**: Acts as the primary target for local search, or acts as the fallback display for cross-project search if `search.defaultView` is set to `chat`.

### `/extract`
- **Description**: Queue L3 decision extraction for the active or specified file
- **Flow**: Mirrors `docuvia.runExtraction` but triggered conversationally.

### `/help`
- **Description**: Show available commands and usage
- **Flow**: Displays standard markdown instructions for using the Docuvia extension.
