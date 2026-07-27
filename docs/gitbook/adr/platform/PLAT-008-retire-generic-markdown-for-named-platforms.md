---
id: PLAT-008
title: Retire the "Markdown Agents" Catch-All for Four Named Platforms
status: accepted
date: 2026-07-23
domains: [platform]
supersedes: []
superseded_by: []
---

# Retire the "Markdown Agents" Catch-All for Four Named Platforms

## Context

`docuvia init`/`docuvia uninstall` select platform integrations from
`getAvailablePlatforms()` (`artifacts/cli/src/utils/platform-selection.ts`). Before this
decision, that list held three entries: `Cursor`, `Claude`, and a catch-all
`GenericMarkdownPlatform` (display name "Markdown Agents", slug `markdown`).

"Markdown Agents" wrote the same static `AGENT_INSTRUCTIONS` block into **five** files in one
shot: `.github/copilot-instructions.md`, `CLAUDE.md`, `.windsurfrules`, `.cursorrules`, and
`llms.txt`. Because the interactive checkbox defaults every entry to checked
([IFCE-001](../interface/IFCE-001-wizard-style-interactive-cli.md)), and headless runs install
every platform unconditionally, picking (or defaulting into) this one bucket silently wrote five
files a user may only have wanted one or two of — most of which have no relationship to the tools
the user actually runs. `INIT_HOOKS_SUPPORTED`'s message compounded this by advertising "Claude
Code, Cursor, GitHub Copilot, Windsurf, Zed, Continue, OpenCode, Gemini CLI" as supported, none of
which (besides Claude/Cursor) had a real integration behind them.

Separately, `UI_MESSAGES`/the platform installers already establish a hard invariant worth naming
explicitly: **no installer ever deletes a folder it doesn't exclusively own.** `ClaudePlatform`
and `CursorPlatform` only ever `fs.unlink()` the specific file they wrote
(`docuvia-hook.js`/`docuvia-hook.cjs`), only `fs.rmdir()` (non-recursive) a hooks directory after
confirming it's empty, and only delete a shared config file (`hooks.json`,
`claude_desktop_config.json`) after an exact-content match proves Docuvia's own writes are the
only thing in it. Shared markdown files (`CLAUDE.md`, `.cursorrules`, etc.) are never touched
outside their `<!-- docuvia:start -->`/`<!-- docuvia:end -->` marker block, via
`writeOrAppend`/`removeBlock` in `fs-utils.ts`, which also drops a `.bak` backup before any
block removal. This decision continues that invariant for every new platform added below, and
states it as a rule for future platforms too.

## Decision

1. **`GenericMarkdownPlatform` is removed** from `getAvailablePlatforms()`. It is replaced by four
   named, independently selectable platforms — each owns exactly one target file/dir and is
   scoped to real, verified behavior of that tool (not aspirational):

   | Platform                 | Slug       | Target                            | Write strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | ------------------------ | ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | GitHub Copilot           | `copilot`  | `.github/copilot-instructions.md` | marker block (`writeOrAppend`/`removeBlock`) — file is commonly hand-authored/shared with other tooling                                                                                                                                                                                                                                                                                                                                                              |
   | Codex (OpenAI Codex CLI) | `codex`    | `AGENTS.md` (repo root)           | marker block — `AGENTS.md` is a near-universal, frequently pre-existing project file (this repo's own `AGENTS.md` is a real example); never fully overwritten or deleted                                                                                                                                                                                                                                                                                             |
   | Continue                 | `continue` | `.continue/rules/docuvia.md`      | **dedicated file** Docuvia alone owns (Continue's own convention: markdown files under `.continue/rules/` are auto-loaded — see `docs.continue.dev/customize/deep-dives/rules`); `uninstall` unlinks this one file outright (safe — Docuvia is the sole author of this filename) and `rmdir`s `.continue/rules/` only if it's empty afterward. **`.continue/` itself is never touched** — it is Continue's folder, not Docuvia's, and may hold the user's own rules. |
   | Hermes Agent             | `hermes`   | `.hermes.md` (repo root)          | marker block — Hermes's own context-file priority chain is `.hermes.md → AGENTS.md → CLAUDE.md → .cursorrules` (first match wins, per `hermes-agent`'s `context-files.md`), so a dedicated `.hermes.md` is written instead of piggybacking on `AGENTS.md`/`CLAUDE.md`, both of which may be masked by a higher-priority file or owned by a different platform's block                                                                                                |

   Codex was verified to read `AGENTS.md` (repo-root + nested, `/init` scaffolds it) via
   `developers.openai.com/codex/guides/agents-md`. Continue was verified to _not_ yet support
   `AGENTS.md` as of the current release (tracked as an open feature request,
   `github.com/continuedev/continue/issues/6716`) — its shipped mechanism is `.continue/rules/*.md`
   — which is why Continue gets a dedicated file instead of joining the `AGENTS.md` writers.

2. **Windsurf (`.windsurfrules`) and `llms.txt` are dropped, not replaced.** No platform installs
   them going forward, and no `--platform=` slug maps to them. `uninstall` keeps a best-effort,
   always-run (not platform-selection-gated) legacy cleanup step that strips the
   `docuvia:start`/`docuvia:end` block from `.windsurfrules`, `llms.txt`, `CLAUDE.md`, and
   `.cursorrules` if present, so repositories set up under a pre-PLAT-008 Docuvia version can still
   fully clean up via a plain `docuvia uninstall` — mirroring how `ClaudePlatform.uninstallHooks`
   used to best-effort-clean (now print-only, see IFCE-002) a legacy global `claude_desktop_config.json`
   entry left by pre-IFCE-002 versions. This is cleanup-only: it never runs on `init`.

   `CLAUDE.md` and `.cursorrules` are included in that legacy sweep because "Markdown Agents" used
   to write to them too, even though `ClaudePlatform`/`CursorPlatform` never did — removing the
   bucket must not leave orphaned blocks in files the new platform list no longer touches on
   install. Copilot's `.github/copilot-instructions.md` is _not_ in the legacy-only sweep, since
   the new `copilot` platform still owns and cleans that file on every uninstall.

3. **`INIT_HOOKS_SUPPORTED`** is corrected to list only what `getAvailablePlatforms()` actually
   returns: Claude, Cursor, GitHub Copilot, Codex, Continue, Hermes Agent.

4. **No new folder-deletion behavior is introduced.** The one new "own a whole path" case
   (Continue's `.continue/rules/docuvia.md`) follows the existing `docuvia-hook.js` precedent
   exactly: unlink the one file Docuvia authored, `rmdir` (non-recursive, best-effort) only the
   directory Docuvia would have created for it if now empty, and never touch the parent
   third-party directory (`.continue/`). Every other new platform uses the existing marker-block
   append/remove path and is therefore incapable of deleting anything outside its own block.
   Full-folder deletion stays reserved for Docuvia's own `.docuvia/` workspace directory (handled
   elsewhere, by `clean`/`uninstall`'s database-cleanup step — unaffected by this decision).

## Consequences

- **Positive**: Selecting (or defaulting into) one platform no longer silently writes files for
  tools the user never mentioned. Every listed platform now corresponds to a real, verified
  integration. The "never delete a folder we don't exclusively own" invariant is now written down,
  not just implicit in the existing Claude/Cursor code, so future platform additions have a rule to
  follow.
- **Negative**: Windsurf and `llms.txt` users lose first-class `init` support; they can still hand-
  edit those files, but `docuvia init` will not maintain them. If demand resurfaces, Windsurf can
  be reintroduced as its own named platform (same shape as Copilot) without reopening this decision.
- **Negative**: Six platforms now show in the interactive checkbox instead of three, all
  default-checked (per IFCE-001) — a plain `docuvia init` on a real TTY still writes to more files
  than before this change for a user who wants only one tool's integration; `--platform=<slug>` is
  the documented escape hatch (see `docuvia init --help`/`docs/gitbook/user-guide/cli/init.md`).
