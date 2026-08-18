# `docuvia review`

The `review` command analyzes a Git diff and evaluates the risk level of the structural changes introduced. It is primarily used to check if a commit or a Pull Request modifies critical paths.

> **Note on Docuvia2:** This command performs file-level change detection and risk scoring. It is completely unrelated to the deferred "Parallel Swarm Review" concept.

## Usage

```bash
docuvia review [baseRef]
```

## Options

### Arguments

- `[baseRef]`: Specify the base git ref to compare against (defaults to `main` or the default branch, such as `master` depending on repo setup).

### Flags

- `--format=<human|json>`: Specify the output format. `human` (default) renders the risk level and analysis summary; `json` emits the structured `ChangeDetectionResult` verbatim (`baseRef`, `filesChanged`, `affectedNodes`, `riskLevel`, `analysis`) as pure JSON on stdout with the banner/spinner suppressed. An unknown value fails fast with a list of the available formats.

## Under the Hood

When you run `docuvia review`:

1. **Git Diff**: The command calculates the changed files against the `[baseRef]` branch.
2. **Blast Radius Overlay**: For each changed file, it queries the SQLite `node_links` table to find incoming edges (dependents).
3. **Risk Scoring**: It flags changes as `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL` depending on how many core nodes (L1 tags) are affected by the changes.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/review.log`.

## Examples

Review the current branch against `main`:

```bash
docuvia review main
```
