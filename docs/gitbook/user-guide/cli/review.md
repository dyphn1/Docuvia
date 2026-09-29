# `docuvia review`

The `review` command analyzes a Git diff and evaluates the risk level of the structural changes introduced. It is primarily used to check if a commit or a Pull Request modifies critical paths.

> **Note on Docuvia2:** This command performs file-level change detection and risk scoring. It is completely unrelated to the deferred "Parallel Swarm Review" concept.

## Usage

```bash
docuvia review [baseRef] [--head <ref>]
```

## Options

### Arguments

- `[baseRef]`: Specify the base git ref to compare against (defaults to `main` or the default branch, such as `master` depending on repo setup).
- `--head <ref>`: Opt into committed-range mode. `<ref>` must resolve to the checked-out `HEAD`.
  The command then reviews exactly the committed range `merge-base(baseRef, HEAD)..HEAD`;
  working-tree and untracked-file changes are excluded. Use this mode for CI or Pull Request
  review.

### Flags

- `--format=<human|json>`: Specify the output format. `human` (default) renders the risk level and analysis summary; `json` emits the structured `ChangeDetectionResult` verbatim (`baseRef`, `filesChanged`, `affectedNodes`, `riskLevel`, `analysis`) as pure JSON on stdout with the banner/spinner suppressed. An unknown value fails fast with a list of the available formats.

Without `--head`, review keeps its local working-tree semantics: it compares the supplied
`baseRef` directly against the current working tree, so uncommitted tracked edits are included.
This is useful as a pre-commit safety check. For a stable CI/PR review, use `--head HEAD` (or a
ref that resolves to the checked-out `HEAD`) so hook installation and other workspace mutations
cannot affect the file list.

## Under the Hood

When you run `docuvia review`:

1. **Git Diff**: Without `--head`, the command calculates changed files from `[baseRef]` to the
   working tree. With `--head`, `<ref>` must resolve to the checked-out `HEAD`; the command then
   resolves `merge-base([baseRef], HEAD)` and calculates the strict two-ref diff from that merge
   base to `HEAD`.
2. **Blast Radius Overlay**: For each changed file, it queries the SQLite `node_links` table to find incoming edges (dependents).
3. **Risk Scoring**: It flags changes as `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL` depending on how many core nodes (L1 tags) are affected by the changes.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/review.log`.

## Examples

Review the current branch against `main`:

```bash
docuvia review main
```

Review the committed Pull Request range in CI:

```bash
docuvia review origin/main --head HEAD --format=json
```
