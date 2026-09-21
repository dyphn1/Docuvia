<!-- docuvia:start -->

# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Grep/Glob/Read are the most expensive tools available to you — before reaching for them to explore the codebase, query the local knowledge graph instead, and before editing a symbol or file, check its blast radius:

Run: `npx --no-install docuvia query "<concept_or_file>" --format=prompt`
Run: `npx --no-install docuvia impact <symbolOrFile>`

Use the results to understand architectural boundaries, historical decisions, and potential blast radius before modifying code. Only fall back to Grep/Glob/Read when the graph returns nothing, the target is flagged `tier_b_status="unprocessed"` (unknown, not zero), you need exact source text/formatting a structural query can't capture, or `query` returns a non-`exact` `match_type` (keyword/neighbor) for what should be a well-known symbol or file.

After making a code change that reflects a real architectural decision, rule, or notable rationale, stage it so the graph picks it up without a separate write step:

Run: `npx --no-install docuvia analyze <file> --agent-authored --stage`

Pipe a JSON payload on stdin (default) — `{"decisions":[{"title":string,"content":string,"nodeType":"change"|"rule"|"decision"|"context","confidence":number}]}` — or pass `--decisions-file=<path>` instead. Put `--agent-authored`/`--stage` after the positional `<file>`, not before — a flag preceding the path silently swallows it as the flag's own value. Staged decisions flush into the knowledge graph automatically the next time you commit a change touching that file — nothing else to run.
<!-- docuvia:end -->

# Harness OS Guidance (Advisory)

Harness is an observer/router/reminder layer on this surface; do not treat its workflow guidance as a hard scheduler.

## 🚦 ENTRY TRIAGE & WORKFLOW GUIDANCE

For software/project work, load the `harness-everything` skill and establish routing context before broad mutation:

1. Run `npx github:dyphn1/Harness-everything next "<Brief summary of user's prompt>"` when terminal execution is available.
2. For EVERY suggested skill, read its complete `SKILL.md` entry and evaluate applicability from `USE FOR`, `DO NOT USE FOR`, and its basic flow.
3. Treat the selected workflow topology and numeric limits as planning guidance, not a lock. Choose, combine, reorder, or skip steps when evidence supports it.
4. Prefer objective verification before declaring done and worktree isolation for broad/Tier-3 mutation.
5. Surface a compact routing checkpoint with tier, strategy, suggested skills, and any relevant warnings.

## 🤖 COGNITIVE COMPLIANCE

- **No universal skill pipeline**: do not force every task through TODO/TDD/Fable.
- **Rule of 3**: after 3 same-signature failures, stop micro-retrying and use a fresh diagnosis / zoom-out. This reflection boundary may block mutation until completed.
- **Permission boundaries are separate**: explicit host/user approval for destructive or external actions remains authoritative.
- **Verification is evidence, not a cage**: missing evidence should trigger a reminder, not a persistent workflow lock.
- **Environment discovery**: discover OS, shell, package manager/runtime, and host capability before relying on them.
- **Memory / self-evolve**: persist only verified reusable lessons.
- **Prefer editing**: prefer targeted edits and logically complete commits over broad rewrites.
