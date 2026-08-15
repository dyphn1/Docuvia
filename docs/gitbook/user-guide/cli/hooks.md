# `docuvia hooks`

`hooks` manages Docuvia's toggleable automation behaviors after `init`/`uninstall` have already run. `init`/`uninstall` own "install/remove everything for platform X"; `hooks` owns fine-grained enablement on top of that — disabling a hook here never removes the files `init` wrote, it only gates whether the automatic trigger those files (or the git hooks) contain actually fires.

## Usage

```bash
docuvia hooks <subcommand> [hookName]
```

## Options

### Subcommands

- `list`: Print every hook name and its current enabled/disabled status. Ignores `[hookName]`.
- `enable <hookName>`: Turn a hook on.
- `disable <hookName>`: Turn a hook off.
- `check <hookName>`: Exit `0` if the hook is enabled, `1` if it's disabled or `<hookName>` isn't a valid name. No stdout on the happy path — this is primarily for **internal/scripted use** (the `tier-b-c-prepush` pre-push hook's `&&` chain shells out to it, and the post-commit flush step performs the equivalent check internally), not typical interactive use. A human checking hook status wants `list`, not `check`. A read failure (missing `.docuvia/`, an unreadable config file) deliberately fails **open** — exit `0`, as if enabled — rather than `1`: this verb's whole job is gating an automatic trigger, and it must never itself be the reason a healthy pipeline stops running.

### Flags

_(This command does not accept any flags.)_

## Hook names

- **`context-injection`**: The `PreToolUse`-style script (`docuvia-hook.js`, written by `init` to each platform's hooks directory) that shells out to `docuvia query` before `Grep`/`Glob`/`Bash`/`Read`, injecting graph context into the agent's view. Because it fires on every matched tool call, its enabled check is a plain synchronous file read — never a second CLI subprocess spawn — to keep the added latency negligible.
- **`commit-l3-write`**: The post-commit hook step (`docuvia analyze --flush-staged-l3`) that drains any decisions staged via `docuvia analyze <file> --agent-authored --stage` into `l3_nodes`, tagged with the commit that triggered the flush. See [`docuvia analyze`](analyze.md) (Mode D) for the staging/flush mechanics this hook automates.
- **`tier-b-c-prepush`**: The pre-push hook's existing Tier B/C batch (`analyze --escalate-to-lsp --fallback-ast && snapshot && sync-knowledge`). Disabling it makes `docuvia hooks check tier-b-c-prepush` exit `1`, which short-circuits that `&&` chain before any of those commands run — the push itself is never blocked either way, since the hook's own trailing `exit 0` is unaffected by the toggle.

All three ship **enabled by default** — running `docuvia hooks list` on an already-set-up repo reports today's always-on behavior, not a surprise opt-out. The toggle only ever gates the _automatic_ trigger, never the underlying CLI capability: with `tier-b-c-prepush` disabled, you can still run `docuvia analyze --escalate-to-lsp` by hand at any time.

## Config file

Hook state lives in a flat JSON file, `.docuvia/hooks-config.json` (e.g. `{ "context-injection": true, "commit-l3-write": true, "tier-b-c-prepush": true }`) — not in `local.db`. `enable`/`disable` read-modify-write the whole file and create `.docuvia/` first if it doesn't exist yet (so `hooks enable` works even before `docuvia init` has run). A missing file is treated as "never configured" and reports every hook as enabled (the current defaults); an unparseable or wrong-shape file logs a warning and falls back to the same defaults rather than crashing or overwriting something it can't trust. A valid file that's missing one of the three keys (e.g. written by an older Docuvia version) has the gap filled in from the defaults, so a hook added in a later release reports correctly without requiring a config migration.

## Examples

List every hook and its current status:

```bash
docuvia hooks list
```

Opt out of the Tier C agent-authored backfill:

```bash
docuvia hooks disable commit-l3-write
```

Re-enable it later:

```bash
docuvia hooks enable commit-l3-write
```

Check a hook's status from a script (exit code only, no output):

```bash
docuvia hooks check tier-b-c-prepush && echo "enabled"
```
