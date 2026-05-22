# Docuvia VS Code Extension: Phase 1 Implementation Plan

This document outlines the technical design and step-by-step plan for implementing Phase 1 of the Docuvia VS Code extension. The goal is to establish the local knowledge storage schema and create the foundational extension skeleton.

## 1. Technical Design

The extension will serve as the primary interface for developers to interact with Docuvia's knowledge graph directly from their editor. The core of Phase 1 is to establish a robust local-first data model. The extension will read knowledge entities from a special `.docuvia` directory in the workspace, parse them, and hold them in an in-memory store for quick access. A file system watcher will keep this store synchronized with any changes on disk.

### 1.1. Local Data Schema (`.docuvia/`)

We will use a combination of YAML and Markdown with YAML frontmatter to represent the knowledge graph. All entities will be identified by a unique ID (UUID/CUID) to allow for stable linking, paired with human-readable slugs for git diff readability.

- **`l1_tags.yaml`**: A list of Level 1 tags.
  ```yaml
  - id: 'tag_ckx123...'
    slug: 'performance'
    name: 'Performance'
    description: 'Concerns related to system performance and optimization.'
  ```

- **`l2_modules.yaml`**: A list of Level 2 modules, associated with L1 tags.
  ```yaml
  - id: 'mod_xk9p...'
    slug: 'authentication'
    name: 'Authentication'
    description: 'Handles user authentication and session management.'
    l1_tag_id: 'tag_ckx123...' 
    source_paths: ['src/lib/auth/**']
  ```

- **`l3_router.yaml`**: Defines the Level 3 routing map, linking L3 UUIDs to their Markdown files to prevent expensive full-directory scans on startup.
  ```yaml
  - id: 'dec_pq3f...'
    l2_module_id: 'mod_xk9p...'
    slug: 'use-jwt'
    title: 'Use JWT for Session Management'
    file_path: 'l3_decisions/use-jwt.md'
  ```

- **`l3_decisions/*.md`**: Individual architectural decisions with metadata in the YAML frontmatter.
  ```markdown
  ---
  id: 'dec_pq3f...'
  l2_module_id: 'mod_xk9p...'
  title: 'Use JWT for Session Management'
  date: '2026-05-22'
  status: 'accepted'
  ---
  ## Context
  We need a secure and stateless way to manage user sessions...
  ```

### 1.2. Global Configuration (`~/.docuvia/config.yaml`)

A global configuration file in the user's home directory will store settings that are not project-specific.

```yaml
# ~/.docuvia/config.yaml
server_url: 'https://api.docuvia.internal'
telemetry:
  enabled: true
```
*(Note: API tokens will be managed securely via VS Code `SecretStorage`, not plain text YAML).*

### 1.3. In-Memory Knowledge Store

A singleton class `KnowledgeStore` will be responsible for:
- Holding the parsed data from the `.docuvia` directory in `Map` objects.
- Providing methods to query the data.
- Loading and parsing all relevant files upon workspace initialization.
- Updating its state when files are created, changed, or deleted via file watchers.

## 2. Required NPM Packages

- `vscode`: Core Extension API.
- `yaml`: A robust parser for YAML files.
- `gray-matter`: For parsing YAML frontmatter from Markdown files.
- `cuid2` or `uuid`: To generate collision-resistant unique IDs.
- `zod`: For validating the parsed YAML data structure at runtime.

## 3. Step-by-Step Implementation Guide

### Step 1: Initialize the Extension Project
1. Scaffold a new VS Code extension package in `artifacts/vscode-client`.
2. Configure `package.json` to integrate with the existing `pnpm` monorepo structure.
3. Install dependencies: `yaml`, `gray-matter`, `zod`, `uuid`/`@paralleldrive/cuid2`.

### Step 2: Define Data Types and Schemas
Create `src/types.ts` defining TypeScript interfaces and `zod` schemas for `Tag`, `Module`, `RouterEntry`, and `DecisionFrontmatter`.

### Step 3: Implement Parsers
Create `src/parser.ts` to parse YAML and Markdown files safely, returning validated types using the Zod schemas.

### Step 4: Implement the Knowledge Store
Create `src/KnowledgeStore.ts` with methods to `loadWorkspace()`, managing the internal memory maps.

### Step 5: Implement File System Watcher
In `src/extension.ts`, wire up `vscode.workspace.createFileSystemWatcher` to monitor `.docuvia/**/*.{yaml,md}` and dynamically update the `KnowledgeStore`.