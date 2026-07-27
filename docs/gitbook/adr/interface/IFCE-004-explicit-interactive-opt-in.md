---
id: IFCE-004
title: Explicit Interactive Opt-In (--interactive/-i)
status: accepted
date: 2026-07-27
domains: [interface]
supersedes: [IFCE-001]
superseded_by: []
---

# Explicit Interactive Opt-In (`--interactive`/`-i`)

## Context

[IFCE-001](IFCE-001-wizard-style-interactive-cli.md) auto-triggers every interactive surface (the bare-`docuvia` wizard menu, `init`/`clean`'s confirmations, `sync`/`query`'s missing-argument prompts, `init`/`uninstall`'s platform checkbox, `analyze --escalate-to-lsp`'s Tier B gate confirmation) off a single check: `!process.stdin.isTTY || process.env.CI`. The assumption was that a real human at a real terminal is the only case where `stdin.isTTY` reads `true`.

That assumption doesn't hold. Several agent- and terminal-integration shells allocate a pty for the child process — so `stdin.isTTY` reads `true` — without ever delivering a real keypress behind it. `@inquirer/prompts` (this CLI's prompt library) has no built-in timeout: a `select()`/`confirm()`/`input()`/`checkbox()` call in that situation waits for a `keypress` event that will never arrive, and the process hangs forever with no way for the caller to interrupt it short of killing the process. `CI` is not a reliable backstop either — it's unset in exactly these agent-shell sessions, which are not CI runs.

An audit of every `ui.ask*()` call site (`cli.ts`, `init.ts`, `clean.ts`, `sync.ts`, `query.ts`, `platform-selection.ts`, `analyze.ts`) found 7 independent instances of this pattern, only 2 of which even checked `CI` alongside `isTTY`.

## Decision

Interactive prompts are opt-in, not TTY-guessed. A prompt only fires when the caller explicitly passes `--interactive`/`-i`, **and** the safety floor IFCE-001 already established still holds (`process.stdin.isTTY` actually true, `process.env.CI` unset):

1. **`--interactive`/`-i` reinstated**: The flag IFCE-001 deliberately abolished is back, as the sole trigger for every prompt in the CLI. `docuvia -i` (bare) launches the wizard menu; `docuvia <command> -i` allows that command's own confirmations/inputs to fire.
2. **No flag, no prompt, ever** — regardless of what `stdin.isTTY` reports. A command that needs a value it wasn't given (e.g. `sync` with no project id) still fails fast with usage instructions, exactly like the non-interactive path already did under IFCE-001; it just no longer has an auto-triggered alternative.
3. **`-i` fails fast, not silently, when it can't be honored**: if `-i` is passed but `stdin` isn't actually a usable TTY (or `CI` is set), the bare-wizard invocation exits 1 with a clear error instead of attempting to prompt; a `<command> -i` invocation prints one warning and continues non-interactively (the command itself is still runnable without the prompt). Neither path silently ignores the flag or attempts a prompt it can't service.
4. **One piped-data check is deliberately untouched**: `sync.ts`'s `commitSha ?? (process.stdin.isTTY ? undefined : readStdin())` stays keyed on the raw TTY check — it's "is there piped data on stdin to consume" (the pre-push hook pipes a commit sha in), not a prompt-safety gate, and swapping it for the opt-in flag would make a human at a real terminal hang waiting for stdin to close instead.

## Consequences

- **Positive**: An agent or script that never passes `-i` can no longer be hung by a prompt, regardless of what its shell reports for `stdin.isTTY`. This closes the exact failure mode IFCE-001 set out to prevent but didn't fully close.
- **Negative**: A human on a real terminal no longer gets the wizard/confirmations for free — `docuvia` alone now prints usage (as it always did in non-TTY mode) instead of launching the menu; `docuvia init`/`docuvia clean` proceed straight to their non-interactive default instead of confirming. They now type `docuvia -i` / `docuvia init -i` to opt in.
- **Neutral**: `CLI_COMMAND_FLAGS` (`cli-commands.ts`) is now the single source of truth for which commands accept `--interactive`/`-i`, shared by `checkUnknownFlags()` and the new `docuvia <command> --help` output — a command that has no prompt to offer (e.g. `status`, `doctor`) doesn't accept the flag.
