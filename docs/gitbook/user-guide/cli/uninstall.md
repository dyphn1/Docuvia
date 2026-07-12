# docuvia uninstall

Securely reverses `init` hooks and removes Docuvia artifacts, leaving the repository pristine.

## Usage

```bash
docuvia uninstall
```

### Flags

- `--platform=<slug1,slug2,...>`: Only remove the named integrations. Available slugs: `cursor`, `claude`, `markdown`. Omit to remove every integration installed by `init` — the same interactive checkbox / all-platforms default described in [`docuvia init`](init.md) applies here too.
- `--global`: Also remove Docuvia's MCP server entry from the machine-global Claude Desktop config (not just the repo-scoped hooks).
- `--keep-db`: Reverse the agent integrations but leave `.docuvia/local.db` in place. By default `uninstall` drops the local database, sharing logic with `docuvia clean`.

## Description

This command gracefully undoes the integration steps performed by `docuvia init` without data loss.

### Features

- **Safe JSON Manipulation**: Removes the Docuvia MCP server entry from `claude_desktop_config.json` without destroying the user's manual formatting.
- **Lossless Markdown Removal**: Safely slices out `<!-- docuvia:start -->` and `<!-- docuvia:end -->` blocks in `.cursorrules`, `CLAUDE.md`, etc., while creating `.bak` backup files to prevent accidental loss of user edits within those blocks.
- **Full Cleanup**: Deletes Docuvia-specific `.claude/hooks` and drops the `local.db` database (sharing logic with the `clean` command), unless `--keep-db` is given.

## Examples

Remove everything `init` installed, including the local database:

```bash
docuvia uninstall
```

Only remove the Cursor integration, keep the local database:

```bash
docuvia uninstall --platform=cursor --keep-db
```
