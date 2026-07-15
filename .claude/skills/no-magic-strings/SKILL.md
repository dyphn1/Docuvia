---
name: no-magic-strings
description: 'Use when asked to find, audit, or eliminate magic strings / hardcoded literals in this codebase — enum-like tags, type discriminants, user-facing messages, log messages, structured-log event names, and special strings like ".git", ".docuvia", file extensions, env var names, or CLI flag names that appear inline instead of as a named constant. Also use proactively before adding a new string literal anywhere outside a constants module. Scans tracked files with `git ls-files` + `grep`, classifies each hit as a definition site (fine) or a use site (must be extracted), and routes new constants to the correct package/file per the Virtual Contracts layering.'
---

# Eliminate Magic Strings

## The rule

A string literal (`"..."`, `'...'`, or a backtick template) may appear directly in a
`.ts`/`.tsx` file **only** at its _definition site_ — the immediate value of a
top-level `export const NAME = "..."`, or a property value inside such a
declaration's `as const` object/array. Every other appearance — a function
argument, a thrown error, a log call, a JSX attribute, a comparison
(`if (status === "pending")`), a `switch`/`case` value, an object built at
runtime — is a **use site** and must reference the named constant instead of
repeating the literal.

This covers everything the user cares about, because they're all just "a
string literal at a use site":

- Enum-like tags / type discriminants (`"pending"`, `"active"`, `kind: "file"`)
- User-facing and log messages (`logger.warn("...")`, thrown `Error` text)
- Structured-log event names (`{ event: "clean.summary" }`)
- Special / reserved strings: `.git`, `.docuvia`, file extensions, default
  filenames, env var names, HTTP header names, CLI flag/command names,
  config keys

## What's exempt — do not extract these

- `""` / `''` (empty string)
- Pure formatting/glue strings with no independent meaning: join/split
  separators (`.join(", ")`, `"\n"`, single-space padding), and string
  _concatenation_ glue (e.g. the `": "` in `` `${label}: ${value}` `` is
  borderline — leave it if the surrounding text is already covered by named
  constants and only a punctuation glue character remains)
- Import/export module specifiers (`import x from "./foo.js"`) — including
  the closing `} from "pkg";` line of a multi-line import
- Regex literals (`/foo/g`) — not string literals at all
- Anything at a **definition site**, regardless of which file it's in (see
  "Two homes for constants" below)
- Test files (`*.test.ts`, `*.spec.ts`, `*.unit.test.ts`) — lower priority;
  note them but don't force extraction unless the literal is a fixture
  reused across multiple test files

## Two homes for constants (this repo already uses both — match, don't invent)

1. **Package-wide constants** — `<package>/src/constants/<topic>.ts`, for
   values used across multiple files/commands within that package. Existing
   examples: `lib/contracts/src/constants/encoding.ts`,
   `lib/contracts/src/errors/error-codes.ts`,
   `artifacts/cli/src/constants/cli-errors.ts`,
   `artifacts/cli/src/constants/docuvia-paths.ts`.
2. **Feature-local constants** — a colocated `<feature-dir>/<feature-name>-messages.ts`
   next to the workflow that owns the strings, when they're used by exactly
   one workflow/command. Existing example:
   `lib/ui-core/src/workflows/sync-knowledge/sync-knowledge-messages.ts`
   (`SYNC_KNOWLEDGE_MESSAGES.SYNCING`), consumed only by
   `sync-knowledge-workflow.ts`. Every workflow under `lib/ui-core/src/workflows/*`
   follows this `*-messages.ts` pattern.

Rule of thumb: **used by one file → colocate `*-messages.ts` next to it.
Used by ≥2 files → promote to that package's `src/constants/`.**

Never create a brand-new file for one string if a suitable constants
file/object already exists nearby — extend it instead (e.g. add a new key to
`CLEAN_MESSAGES` rather than a second messages file in the same workflow
directory).

## Respect the Virtual Contracts layering

Per `docs/gitbook/architecture/virtual-contracts-architecture.md`:
`artifacts/cli` and `mcp` may depend only on `lib/contracts`, never on
`lib/core` (or any other implementation package) directly. If a string is
needed by both a presentation-layer file and a domain/core file, it must
live in `lib/contracts/src/constants/`, not in `lib/core` — otherwise the
presentation layer can't legally import it. When unsure which package
"owns" a shared string, put it in the lowest layer every consumer is
already allowed to import; see the doc comment on `encoding.ts` for the
worked reasoning.

## Naming & style — no native `enum`, ever

`git grep -n "^export enum\|^export const enum"` returns nothing in this
codebase. Every enum-like value set is an `as const` object. Match it:

```ts
// Single value
export const UTF8_ENCODING = "utf8" as const;

// Grouped / enum-like set
export const ErrorCodes = {
  GIT_COMMAND_FAILED: "GIT_COMMAND_FAILED",
  DB_OPEN_FAILED: "DB_OPEN_FAILED",
} as const;

// Parameterized message — function value inside the const object
export const CLI_ERROR_MESSAGES = {
  UNKNOWN_OPTIONS: (options: string) => `Unknown options provided: ${options}`,
} as const;

// String-literal union: derive the type from the const object,
// don't hand-write `type Status = "pending" | "active";`
export const Status = { PENDING: "pending", ACTIVE: "active" } as const;
export type Status = (typeof Status)[keyof typeof Status];
```

Name files by domain, not by the word "constants": `docuvia-paths.ts`,
`cli-commands.ts`, `sync-knowledge-messages.ts` — never `misc.ts` or
`strings.ts`.

## Scan workflow

**Step 1 — enumerate candidates.** Use the helper script (wraps
`git ls-files` + `grep`, tracked files only, so `.gitignore`d and
`dist`/`coverage`/`node_modules` output is never touched):

```bash
.claude/skills/no-magic-strings/scripts/scan.sh [path-prefix]
# e.g. scripts/scan.sh lib/core
# e.g. scripts/scan.sh artifacts/cli/src/commands
```

It prints `file:line:matched-text` for every quoted/backtick literal in
tracked, non-generated, non-`.d.ts`, non-test `.ts`/`.tsx` files, already
skipping full-line comments and `import`/`export ... from` lines.

**Step 2 — triage each hit by hand.** The script is a candidate finder, not
a linter — it cannot tell a definition site from a use site, and it has
known false-positive classes:

- Multi-line `import { a, b } from "pkg"` where the specifier isn't on the
  filtered first/last line
- Backtick templates that are pure interpolation with no literal text, e.g.
  `` `${UI_MESSAGES.STATUS_PROJECTS}${status.projects}` `` — nothing to
  extract there
- JSDoc/block-comment continuation lines the comment filter didn't catch

For every real hit, classify: exempt (per the list above) → skip; otherwise
→ extract.

**Step 3 — pick the destination** using "Two homes for constants" above:
reuse an existing constants object if the domain already has one, otherwise
create the smallest new file that matches the naming convention.

**Step 4 — extract.** Add/extend the constant, then replace the literal at
every call site with an import + reference. If the literal repeats
verbatim elsewhere in the codebase, search for other occurrences before
finishing so you don't leave a second copy behind.

**Step 5 — GitNexus checks (mandatory, per this repo's CLAUDE.md).** Before
editing an exported symbol whose call sites you're touching, run
`impact({target: "<symbolName>", direction: "upstream"})` and stop to warn
the user if it comes back HIGH or CRITICAL risk. After the sweep, run
`detect_changes({scope: "compare", base_ref: "main"})` to confirm only the
expected symbols/files were touched before treating the work as done.

**Step 6 — verify.** Run the affected package's build/typecheck (e.g.
`pnpm -w build` or the package-local script) — a missed import or a typo'd
constant name is a compile error, not a runtime surprise, so this is cheap
insurance.

## Reporting vs. fixing

If asked to **audit**, produce a table — `file:line | literal | verdict
(extract/exempt) | reason | suggested constant name + destination file` —
and stop there. If asked to **fix**, still scope the sweep explicitly
(one package, one directory, or "everything") before touching call sites in
bulk: a repo-wide sweep touches every package and is not something to run
unannounced. Prefer fixing one package at a time and running its build
between packages over one giant multi-package diff.
