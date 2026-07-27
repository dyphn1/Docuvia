# `docuvia uninstall`

Securely reverses `init` hooks and removes Docuvia artifacts, leaving the repository pristine.

## Usage

```bash
docuvia uninstall [flags]
```

## Options

_(This command does not accept positional arguments.)_

### Flags

- `--platform=<slug1,slug2,...>`: Only remove the named integrations. Available slugs: `cursor`, `claude`, `copilot`, `codex`, `continue`, `hermes`.
- `--keep-db`: Reverse the agent integrations but leave `.docuvia/` (including `local.db`) and the hidden `docuvia-knowledge` git branch in place. By default `uninstall` drops all three — the local database (sharing logic with `docuvia clean`), the rest of the `.docuvia/` directory (logs, lockfiles, `export-topology` artifacts — `clean` deliberately leaves these behind, see [`docuvia clean`](clean.md)), and the orphan `docuvia-knowledge` branch itself.
- `--interactive`, `-i`: Opt-in to interactive prompts (wizard menu, confirmations). Required to see the platform selection checkboxes. If both `--platform` and `--interactive` are absent, Docuvia will uninstall all platform integrations non-interactively.

## Under the Hood

This command gracefully undoes the integration steps performed by `docuvia init` without data loss.

### Features

- **Safe JSON Manipulation**: Best-effort removes the Docuvia MCP server entry from the machine-global `claude_desktop_config.json`, if one is present, without destroying the user's manual formatting — `init` no longer writes this entry ([IFCE-002](../../adr/interface/IFCE-002-strict-repo-scoped-boundaries.md)), but `uninstall` still cleans it up for repos set up under an older Docuvia version.
- **Lossless Markdown Removal**: Safely slices out `<!-- docuvia:start -->` and `<!-- docuvia:end -->` blocks in `.cursorrules`, `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `.hermes.md`, etc., while creating `.bak` backup files to prevent accidental loss of user edits within those blocks. Docuvia never rewrites or deletes a shared file outside its own marker block, and never deletes a folder it doesn't exclusively own (see [PLAT-008](../../adr/platform/PLAT-008-retire-generic-markdown-for-named-platforms.md)) — the one exception is `.continue/rules/docuvia.md`, a file Docuvia alone creates, which is unlinked outright.
- **Legacy Cleanup**: Always attempts to strip leftover Docuvia blocks from `.windsurfrules` and `llms.txt` too, even though `init` no longer writes them — best-effort, so repos set up under a pre-PLAT-008 Docuvia version can still fully clean up with a plain `docuvia uninstall`.
- **Full Cleanup**: Deletes Docuvia-specific `.claude/hooks`, removes both git hooks `init` installed (the post-commit and pre-push hooks — see `doctor`'s "hook present but docuvia not resolvable" check for why leaving them behind is a real footgun), and — unless `--keep-db` is given — drops the `local.db` database (sharing logic with the `clean` command), force-deletes the hidden `docuvia-knowledge` orphan branch, and removes whatever else is left under `.docuvia/`.

## Examples

Remove everything `init` installed, including the local database:

```bash
docuvia uninstall
```

Only remove the Cursor integration, keep the local database:

```bash
docuvia uninstall --platform=cursor --keep-db
```

```bash
docuvia uninstall
```

Only remove the Cursor integration, keep the local database:

```bash
docuvia uninstall --platform=cursor --keep-db
```
