# `export-topology` — Verified Test-Gap Status (2026-07-15)

Checked against `artifacts/cli/src/commands/export-topology.ts`, `artifacts/cli/src/commands/topology-html-template.ts`,
and `lib/ui-core/src/workflows/export-topology/export-topology-workflow.ts`.

| #   | Claim                                                               | Verdict                    | Evidence                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | HTML's embedded JSON graph data never parsed/verified               | **Confirmed — open**       | No test file exists for `topology-html-template.ts` at all. `export-topology.unit.test.ts:67` only checks `.toContain("<!DOCTYPE html>")`; the embedded `var GRAPH = ...` blob is never extracted or round-tripped. |
| 2   | Success message built via English string concatenation              | Confirmed (as description) | Matches `export-topology.ts:56-67` verbatim, but same systemic caveat: no i18n framework exists in this repo at all.                                                                                                |
| 3   | No 100k-node `RangeError` test                                      | Overstated                 | Untested, but 100k small node/link objects are nowhere near `JSON.stringify`'s practical limits — unlikely in practice.                                                                                             |
| 4   | `--out` pointing at an existing file (not dir) untested             | **Confirmed — open**       | `export-topology.ts:51`'s `fs.mkdirSync(outDir, { recursive: true })` would throw if `outDir` is an existing file. It's caught by the outer try (reported via `spinner.fail`), so not a crash, but untested.        |
| 5   | Extraction fails due to TS compilation errors in target project     | False                      | `ExportTopologyWorkflow.execute()` never parses or compiles source — it opens the local DB readonly and reads already-persisted rows. TS compilation isn't a code path this command has.                            |
| 6   | Concurrent Git rebase modifying files during export                 | Overstated                 | The workflow opens the graph store `readonly: true` and only reads the already-committed `local.db` snapshot — it never re-scans the working tree.                                                                  |
| 7   | Running export twice in the same dir (overwrite vs. throw) untested | Overstated                 | The write path is plain `fs.writeFileSync` (unconditional overwrite, standard Node semantics) — low risk despite being untested.                                                                                    |

**Open**: #1 (embedded HTML/JSON never verified — worth a real test), #4 (`--out` as an existing file — cheap to add).
**Bugs observed**: None.
**Tests run**: `export-topology.unit.test.ts` (4/4 pass), `export-topology-workflow.unit.test.ts` (2/2 pass).
