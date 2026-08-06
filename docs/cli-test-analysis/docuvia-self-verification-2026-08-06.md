# Docuvia2 Self-Verification via Docuvia (2026-08-06) — `query` ranking-quality fix (item 25)

Follow-up to [`docuvia-self-verification-2026-08-05.md`](./docuvia-self-verification-2026-08-05.md)'s
item 25: that session's fix (`match_type`) let an agent _tell_ a `query` result was low-confidence,
but didn't make the underlying FTS ranking itself better. This session optimizes the actual match
quality, self-tests it against Docuvia2's own repo through the real CLI (`npx --no-install docuvia
query ... --format=prompt`), and iterates until accuracy exceeds 95%.

## Method

A 27-case self-test harness (`RESOLVABLE_CASES`) was built from real files/symbols in this repo —
each case is a query phrase an agent might plausibly issue, paired with the one file it should
resolve to (ground truth verified via `Glob`/direct SQL before adding each case, not guessed). Every
case runs through the actual built CLI, not a mock or the service layer directly, so the numbers
reflect what an agent following AGENTS.md's Docuvia-First workflow would actually see. Two
supplementary categories are scored separately, not folded into the headline number: 2 "safe-empty"
cases (free text embedded in a comment; an unindexed camelCase export identifier) where the correct
behavior is an empty result that trips the documented Grep/Glob/Read fallback trigger, and one
deliberately ambiguous case (`"init command"`, which has two plausible real targets) reported
informationally.

## Baseline: 51.9% (14/27)

Re-running `docs/cli-test-analysis/docuvia-self-verification-2026-08-05.md`'s single documented
failure (`"query command"` → `init-command-lock.ts` instead of `query.ts`) confirmed it still
reproduced against a freshly rebuilt CLI. Extending the same query shape (`"<command name> command"`)
across every real CLI command in this repo showed it wasn't a one-off: **13 of 27** resolvable cases
failed the same way — `"impact command"`, `"hydrate command"`, `"publish command"`, `"review
command"`, `"analyze command"`, and others all resolved to an unrelated file (most commonly
`init-command-lock.ts`, `clean-messages.ts`, `status-messages.ts`, or similar), each mislabeled
`match_type="keyword"` (a correct low-confidence signal per item 22's fix — but nothing consumed that
signal to search further).

## Root cause: no stemming, and BM25 alone rewards a rare single-term match over a full-phrase partial match

Direct SQL inspection against this repo's own `.docuvia/local.db` (not speculation):

```
AND query+command matches: 0
```

Zero `l2_nodes` rows matched `"query" AND "command"` as literal FTS5 tokens, even though
`artifacts/cli/src/commands/query.ts` obviously matches both concepts. The reason: `l2_nodes_fts`'s
default tokenizer (`unicode61`) does exact token matching with no stemming. The node's path,
`artifacts/cli/src/commands/query.ts`, tokenizes to `commands` (the _plural_ directory segment) —
never `command` (the _singular_ query keyword). They're different tokens. Meanwhile 588 other rows in
this repo contain a literal `command` token (mostly `init-command-lock.ts` and
`command-log-writer.ts`, both short paths where that one term dominates BM25's per-document
relevance) and 136 contain `query` — none of the top 30 raw BM25-ranked OR results for `"query" OR
"command"` even included `query.ts`'s own rows; they were crowded out entirely by the singular/plural
mismatch compounding with sheer candidate-pool size.

## Three layered fixes

1. **`lib/schema/src/sqlite/migrations/0007_fts_porter_stemming.sql`** — rebuilds
   `l2_nodes_fts`/`l3_nodes_fts` with `tokenize='porter unicode61'`. Porter stemming folds
   `"commands"`/`"command"` to the same stem (and `"query"`/`"queries"` likewise) at both index and
   query time (SQLite applies a table's configured tokenizer to `MATCH` text too, so no
   application-code change was needed for this part). Validated empirically against a scratch copy of
   this repo's real database _before_ committing to the migration:

   ```
   AND query+command matches after porter stemming: 10
   15906 artifacts/cli/src/commands/query.ts [...]
   15907 anonymous [...]
   ... (all 10 rows are query.ts's own symbol nodes)
   ```

2. **`lib/schema/src/sqlite/repos/fts-repo.ts`** — `searchL2Nodes`/`searchL3Nodes` now try an AND
   match (every keyword must match the same row) first, only widening to the previous OR match when
   AND finds nothing. This is exactly the "fallback strategy when the top FTS hit scores far below
   what an exact match would" that item 25 originally flagged as missing. A single-keyword query's AND
   and OR expressions are identical, so this is a no-op for the case that already worked well.

3. **`lib/core/src/query/query.service.ts`** — two changes for the cases AND-first still can't fully
   resolve (3+ keyword queries where no single row matches every term):
   - The OR-fallback path now re-ranks candidates by how many distinct query keywords they cover
     (stable sort — ties keep BM25's own order), before the existing 0.9/0.85-descending score bands
     are assigned. The FTS candidate pool is also widened internally (5x the caller's `limit`, min 25)
     so a correct partial match that BM25 alone ranks below the return cutoff still gets considered.
   - `extractKeywords()` no longer drops single-character tokens unconditionally. This codebase's own
     Tier A/B/C vocabulary means `"tier c queue"` must keep `"c"` as a keyword or it becomes
     indistinguishable from `"tier b queue"` — the self-test harness caught this as the one
     resolvable case still failing after fixes 1-2 (`"tier c queue"` → `tier-b-queue.ts`). Only the
     stop words `"a"`/`"i"` (the sole single-letter entries in `STOP_WORDS`) are still dropped.

## Result: 100% (27/27)

| Stage                                                   | Resolvable accuracy |
| :------------------------------------------------------ | :------------------ |
| Baseline                                                | 51.9% (14/27)       |
| After fix 1+2 (porter stemming + AND-first/OR-fallback) | 96.3% (26/27)       |
| After fix 3 (coverage re-rank + single-char keywords)   | **100% (27/27)**    |

Safe-empty cases: 2/2 (unchanged — still correctly empty, still correctly trips the fallback
trigger). Ambiguous case (`"init command"`): now resolves to `init.ts` (previously
`init-command-lock.ts`) — plausible either way, reported informationally, not scored.

## OpenCodeReview pass on the diff (same session)

Ran `ocr review` (this repo's own CI-integrated review tool, `.github/workflows/ci.yml`'s
`ocr-review` job, run locally against the working diff instead of a PR) against the 3 source files
above. It correctly skipped the 6 test/doc files (unsupported extension / default test-path
exclusion — expected, not a gap). 5 findings surfaced; each was independently verified against the
actual code rather than applied on trust:

- **Real, fixed**: `countKeywordCoverage`'s original implementation did raw JS substring matching on
  `name`/`description`/`path_patterns`, which can silently disagree with the porter-stemmed FTS
  index (migration 0007) whenever a query keyword and an indexed word share a stem but not a
  spelling (e.g. keyword `"queries"` vs. indexed `"query"`). No test case in this session's harness
  exercised that divergence, so it hadn't caused an observed failure, but it was a real precision
  gap in the re-rank. Fixed by sourcing per-keyword coverage from the FTS index itself (one
  single-keyword search per keyword, intersected against candidate row ids) instead of
  reimplementing tokenization/stemming in JS — see `rerankByKeywordCoverage`'s updated doc comment
  in `query.service.ts`. Re-ran the full test suite + the 27-case harness after the fix: still 305/
  305 tests passing, still 100% (27/27).
- **Not actionable, `operator` param validation on `buildFtsMatchExpression`**: flagged as
  security/medium, but `operator`'s type is a `"AND" | "OR"` TS union with exactly two literal call
  sites in the same file — nothing dynamic reaches it. Matches this project's stated
  don't-validate-what-can't-happen norm; skipped.
- **Not actionable, `runL2Match`/`runL3Match` duplication**: valid observation, but the review's own
  suggested fix (`table.replace('_FTS', '')` against a lowercase `SchemaTables` constant) doesn't
  actually match anything — the suggestion itself has a bug. Two near-identical 8-line methods is
  within this project's "three similar lines beats a premature abstraction" norm; skipped.
- **Not actionable, doc-comment expansion**: subjective low-value nit; the existing comment already
  follows this project's WHY-not-WHAT convention.
- **Incorrect, sort-stability concern on `rerankByKeywordCoverage`**: claimed `Array.prototype.sort`
  might not be stable in "older environments." `Array.prototype.sort` has been spec-guaranteed
  stable since ES2019, and this package targets Node 20 (`artifacts/cli/tsup.config.ts`) — not
  applicable. The code comment was tightened to say so explicitly. Skipped.

Tooling note, not a Docuvia2 issue: `ocr session show`'s persisted summary for this run reported
`query.service.ts` as `failed` with an LLM completion error and 0 comments, while the same run's live
terminal output had already printed 2 real, on-topic comments for that exact file (the two items
above). The comments were genuine (they reference real line numbers and real symbols from this
diff), so the LLM call evidently succeeded on a retry — `ocr`'s own session-log persistence just
didn't get updated to match. Worked around by using the live stdout capture as the source of truth
rather than the session log.

The originally-diagnosed case is fixed verbatim: `docuvia query "query command" --format=prompt` now
returns

```xml
<docuvia_context>
  <l2_module name="artifacts/cli/src/commands/query.ts" type="module" file="artifacts/cli/src/commands/query.ts" match_type="keyword">
  </l2_module>
</docuvia_context>
```

## Verification

- `pnpm run build` (typecheck + all packages) — clean.
- New/updated tests, all passing: `query.service.unit.test.ts` (keyword-coverage re-rank regression
  test reproducing the real bug's shape at small scale; single-char token retention;
  stop-word `"a"`/`"i"` still dropped), `graph-store.integration.test.ts` (AND-first isolates a
  both-keyword match over single-keyword distractors; AND-first falls back to OR when nothing matches
  every keyword; porter stemming unifies plural/singular), `migration-runner.unit.test.ts` (migration
  0007's schema + stemming behavior; the two migration-count assertions bumped from 6→7).
- Full affected-package run: 47 test files, 305 tests, all passing (`lib/core`, `lib/schema`,
  `artifacts/cli`).
- `eslint` on every changed file — clean.
- Self-test harness re-run against the real, freshly rebuilt CLI (not the service layer directly) —
  100% (27/27), reported above.

## Not fixed, deliberately out of scope

- **Free-text/comment search** (`"typescript-cli-benchmark.md"` embedded in a code comment) —
  correctly returns empty and trips the fallback trigger. The graph indexes symbols/paths, not
  arbitrary prose; not a ranking bug.
- **Directory/pattern enumeration** (`"cli commands list"` → 1 file, not a listing of the commands
  directory) — a capability gap (`query` returns a best single match, not an enumeration), not a
  ranking bug. `Glob` remains the right tool for this.
- **Unindexed camelCase export identifiers** (`"docuviaApi"` → empty, only the kebab-case filename
  form `"docuvia-api"` resolves) — the export identifier itself was never extracted as its own L2
  node (only the file-level node exists under the file's path). Correctly empty, correctly trips the
  fallback trigger; fixing it would mean deeper symbol-extraction work, not a ranking change.
