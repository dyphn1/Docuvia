# SVN integration

- **Status**: ⏸️ Pending / Deprecated
- **Phase**: Phase 4: Git-Isomorphic Sync & Temporal Knowledge
- **Evidence / Verification Target**: `lib/core/src/services/svn-client.ts`
- **ADR**: [ADR-031](../../adr/ADR-031-svn-integration-and-diff-ingestion.md)

## Implementation Details

Direct SVN integration has been formally halted and deprecated.

As outlined in ADR-031, mapping SVN constructs (sequential revisions, folder-based branches, external links) directly into our strict Git-Isomorphic architecture causes severe database collision risks and crashes the AST blast radius engine.

To maintain the purity of the core `ingestion-pipeline.ts` and database schemas, Docuvia will remain strictly Git-first.

### Future Path

Any future SVN support will not be handled natively by Docuvia's core. Instead, it will require an external translation layer or proxy tool (such as `git-svn`) to convert the SVN repository into a standard Git repository structure before it can be ingested and analyzed by Docuvia.

### Component Description

- **`lib/core/src/services/svn-client.ts`**: Currently exists but is considered deprecated for diff analysis. It will not be extended further to parse diffs natively.

## Testing & Verification

- SVN integration tests are no longer actively maintained for AST feature parity.
