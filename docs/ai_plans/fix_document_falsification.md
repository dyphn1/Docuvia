# Implementation Plan: Fix Document Falsification

## Overview

A recent 3-Angle Adversarial Check discovered false claims in `docs/architecture/local-first-status.md`. The document states that the CLI supports `build`, `update`, and `evaluate` with a score of 7. However, the codebase does not have these commands. The CLI currently only supports `init`, `analyze`, `extract`, `sync`, `query`, and `mcp`.

## Objectives

1. Correct the false claims regarding the CLI's capabilities in `docs/architecture/local-first-status.md`.
2. Ensure the document accurately reflects reality, establishing trust in the project's architectural documentation.

## Required Edits

### 1. Update `docs/architecture/local-first-status.md`

**Location**: Section 1. User Interfaces, the row corresponding to **CLI**.

- **Current text**:
  `| **CLI**              | CLI Tools           | Local `build`, `update`, evaluate.                           | Core implemented, needs refinement             | 7            | **GitNexus** (`gitnexus-cli` index, analyze, query)                   |`
- **Target modification**:
  - Replace `Local `build`, `update`, evaluate.` with `Local \`init\`, \`analyze\`, \`extract\`, \`sync\`, \`query\`, and \`mcp\`.`
  - Adjust the Score from `7` to `5` to more accurately reflect the existing capabilities (as the current state represents partial completion of its intended goals and needs core API alignment based on the Interface Parity Audit).

## Handover

Once this plan is read, the execution should be handed off to the `Document Writer (MD)` agent to perform the actual file modification.
