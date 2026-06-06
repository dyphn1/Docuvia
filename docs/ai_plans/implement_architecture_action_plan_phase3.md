# Architecture Action Plan - Phase 3: Deepen Editor Context Awakening

## Overview
This phase addresses the fragility of the current context awakening mechanism in the VS Code Client. We will replace the rigid Regex-based UUID literal matching with a robust AST-driven Interval Tree cache, moving all fuzzy resolution out of the latency-sensitive Hover path and into a background Indexer with Self-Healing capabilities.

## Implementation Goals
1. **Interval Tree Caching**: Provide an O(log N) AST cache where `DocuviaHoverProvider` queries `(line)` coordinates instead of performing regex raw string matching.
2. **No-LLM-in-Hover Rule**: Ensure `HoverProvider` reads immediately from memory. Shift all logic for fuzzy-matching L3 Decisions against code symbols into a background `KnowledgeIndexer`.
3. **State-Sync Self-Healing**: Implement background watchers that detect live file modifications (`onDidChangeTextDocument`) to shift line anchors, and file saves (`onDidSaveTextDocument`) to re-anchor orphaned AST symbols automatically via diff/symbol matching.

## Approach / Methodology
- **`IntervalTree` Data Structure**: A simple, generic Interval Tree class to store ranges `[startLine, endLine]` and associated metadata (e.g., `decisionId`, `moduleId`).
- **`KnowledgeIndexer` Singleton**: Acts as a background worker. It listens to `KnowledgeStore` updates and VS Code document events.
  - **Fuzzy Symbol Anchoring**: It reads `L3Decision.file_path` from the Knowledge Graph. It invokes the native `vscode.executeDocumentSymbolProvider` command to get an AST-like view of the file. It then uses simple text-similarity (Jaccard index or substring matching of the decision title against symbol names) to anchor decisions to specific symbols.
  - **Self-Healing**: It hooks `vscode.workspace.onDidChangeTextDocument` to immediately apply line-delta shifts to intervals, ensuring hover accuracy as the user types. On save, it re-evaluates the file's symbols.
- **`DocuviaHoverProvider` Refactoring**: Stripped down to simply query `KnowledgeIndexer.getMatchAt(uri, position.line)`.

## Detailed Implementation Steps

### 1. Create `src/indexer/IntervalTree.ts`
- Implement an `IntervalTree` class storing nodes with `start`, `end`, and `data` (e.g., `string` ID).
- Support `insert(start, end, data)`, `remove(data)`, `search(point)`, and `shiftRanges(fromPoint, delta)` for real-time text edits.

### 2. Create `src/indexer/KnowledgeIndexer.ts`
- Manage a Map of `IntervalTree` instances keyed by file URI (`string`).
- **`indexSnapshot(snapshot)`**: Iterates over all L3 Decisions in a snapshot. For those with valid `file_path`, queue an indexing task.
- **`buildTreeForFile(uri)`**: 
  1. Fetch AST symbols via `vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri)`.
  2. For decisions mapping to this file, find the "best match" symbol using a lightweight fuzzy matcher (e.g., matching words in decision title to symbol names).
  3. Insert the matched symbol's `[range.start.line, range.end.line]` into the file's IntervalTree.
- **`getMatchAt(uri, line)`**: Query the IntervalTree for the specific line and return the matched Decision ID (or Module ID).

### 3. Implement State-Sync Self-Healing (`KnowledgeIndexer.ts`)
- Subscribe to `vscode.workspace.onDidChangeTextDocument`:
  - Calculate line deltas (added/removed lines before the interval).
  - Call `tree.shiftRanges()` to adjust all downstream intervals immediately.
- Subscribe to `vscode.workspace.onDidSaveTextDocument`:
  - Re-trigger `buildTreeForFile(uri)` to heal the tree if symbols were renamed or restructured.

### 4. Refactor `src/DocuviaHoverProvider.ts`
- Remove the `UUID_REGEX` matching logic.
- Inject `KnowledgeIndexer`.
- In `provideHover()`, call `indexer.getMatchAt(document.uri, position.line)`. If a match is found, pull the `L3Decision` from `KnowledgeStore` and construct the Markdown hover. 

### 5. Wire up in `src/extension.ts`
- Instantiate `KnowledgeIndexer`.
- Pass it to `DocuviaHoverProvider`.
- Call `indexer.indexSnapshot(snapshot)` whenever the `KnowledgeStore` emits an `onDidLoad` event.

## Affected Packages & Files
- `@workspace/vscode-client`
  - `src/indexer/IntervalTree.ts` (New)
  - `src/indexer/KnowledgeIndexer.ts` (New)
  - `src/DocuviaHoverProvider.ts` (Modify)
  - `src/extension.ts` (Modify)
  - `src/KnowledgeStore.ts` (Modify if needed to expose events cleanly)
