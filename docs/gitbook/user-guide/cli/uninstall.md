# docuvia uninstall

Securely reverses `init` hooks and removes Docuvia artifacts, leaving the repository pristine.

## Usage

```bash
docuvia uninstall
```

### Flags

- `--platform=<slug1,slug2,...>`: Only remove the named integrations. Available slugs: `cursor`, `claude`, `markdown`. Omit to remove every integration installed by `init` — the same interactive checkbox / all-platforms default described in [`docuvia init`](init.md) applies here too.
- `--keep-db`: Reverse the agent integrations but leave `.docuvia/local.db` in place. By default `uninstall` drops the local database, sharing logic with `docuvia clean`.

## Description

This command gracefully undoes the integration steps performed by `docuvia init` without data loss.

### Features

- **Safe JSON Manipulation**: Best-effort removes the Docuvia MCP server entry from the machine-global `claude_desktop_config.json`, if one is present, without destroying the user's manual formatting — `init` no longer writes this entry ([IFCE-002](../../adr/interface/IFCE-002-strict-repo-scoped-boundaries.md)), but `uninstall` still cleans it up for repos set up under an older Docuvia version.
- **Lossless Markdown Removal**: Safely slices out `<!-- docuvia:start -->` and `<!-- docuvia:end -->` blocks in `.cursorrules`, `CLAUDE.md`, etc., while creating `.bak` backup files to prevent accidental loss of user edits within those blocks.
- **Full Cleanup**: Deletes Docuvia-specific `.claude/hooks`, removes both git hooks `init` installed (the post-commit and pre-push hooks — see `doctor`'s "hook present but docuvia not resolvable" check for why leaving them behind is a real footgun), and drops the `local.db` database (sharing logic with the `clean` command), unless `--keep-db` is given.

## Examples

Remove everything `init` installed, including the local database:

```bash
docuvia uninstall
```

Only remove the Cursor integration, keep the local database:

```bash
docuvia uninstall --platform=cursor --keep-db
```
