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
