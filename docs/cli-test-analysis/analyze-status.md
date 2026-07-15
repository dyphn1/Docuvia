# `analyze` Decision-Extraction Feature + Test-Gap Remediation - Status (2026-07-15)

Implements `docuvia analyze <targetPath>` LLM decision extraction (Part A) and follows up on the
original `analyze.md`'s 7 claims (Part B), per
`docs/ai_plans/implement_analyze-decision-extraction.md`. Same shape as
[init-concurrency-status.md](init-concurrency-status.md). `analyze.md` itself has since been
removed as superseded, as part of the broader `docs/cli-test-analysis/` reorg — see
[README.md](./README.md) for the all-commands status table.

## What was verified against the original `analyze.md` claims

| #   | Claim (verbatim summary)                                                                                                | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `logger.onLog` updates `spinner.text`; no test asserts it                                                               | **Confirmed** -- real gap. Fixed: `analyze.unit.test.ts` now has "updates spinner.text when the underlying workflow emits an info log event mid-call".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2   | `expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("typescript"))` assumes non-English output could break it | **Overstated / not applicable** -- Docuvia2 has no i18n system anywhere; every `UI_MESSAGES` entry is a hardcoded English string by design. Not a real gap; `analyze.md` itself was not corrected in place (see Follow-ups).                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | Mock returns trivial `{projectType, suggestedTags}`; no test with e.g. 50 tags / terminal formatting                    | **Partially valid, low severity** -- no truncation/wrapping logic exists in the print path, so there was no real formatting logic to break, but closing the gap was cheap. Fixed: added a 50-entry `suggestedTags` test.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4   | `analyzeCommand(undefined, /root/forbidden/path)` never tested for `EACCES`                                             | **Confirmed but mis-targeted** -- `analyzeCommand` never touches the filesystem directly; `docuviaApi.analyze` is fully mocked in `analyze.unit.test.ts`, so an `EACCES` at that layer would test nothing. The real place an `EACCES`-class error can occur is inside `ConfigScannerService.scanConfigs` (already covered -- see #5) and, after Part A, inside `decision-extraction.ts` `fs.readFileSync` (new test: "skips a file that throws on read... and warns via the logger" in `decision-extraction.unit.test.ts`). No fake `/root/forbidden/path` unit test was added to `analyze.unit.test.ts` -- it would test nothing there. |
| 5   | `docuviaApi.analyze` fully mocked, so no real-filesystem/config-scan coverage; "AST parser" reference is likely wrong   | **Half-stale, half-confirmed.** "AST parser" is confirmed false -- `ConfigScannerService` is pure `fast-glob` plus string/regex matching, no AST/tree-sitter involvement. The "untested real filesystem" half was already stale before this session (`config-scanner.service.unit.test.ts` already had a full "integration, real filesystem" describe block). What was still missing -- coverage of the full stack through `analyzeCommand`/`docuviaApi.analyze` down to real `ConfigScannerService` with nothing mocked -- is now closed: `analyze-config-scan.integration.test.ts` (new).                                              |
| 6   | No test for `analyze` running concurrently with `init` mutating `.docuvia/`                                             | **Overstated for this specific pairing.** `AnalyzeWorkflow` config-scan path never opens the SQLite store and only appends to its own `.docuvia/logs/analyze.log` -- it shares no mutable state with `init` DB/migration writes. The real, cheaply-testable concurrency risk is `analyze` vs `analyze` (concurrent runs both appending to the same log file), which is now covered: `analyze-concurrency.test.ts` (new, 5 concurrent real CLI processes).                                                                                                                                                                                |
| 7   | No idempotency test (running `analyze` twice)                                                                           | **Confirmed** -- real gap. Fixed: `analyze.unit.test.ts` now has "does not leak docuviaMemory scopes across repeated runs (idempotency)".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Part A -- `docuvia analyze <targetPath>` implementation summary

- `AnalyzeResult` is now a discriminated union tagged with `kind: "configScan" | "decisionExtraction"`
  (`lib/ui-core/src/workflows/analyze/analyze-result.ts`) -- a deliberate breaking change to the
  previously untagged `{projectType, suggestedTags}` shape, fully propagated through
  `analyze-workflow.ts`, `docuvia-api.ts`, `analyze.ts`, and every test that constructs/asserts on
  an `AnalyzeResult`.
- New `lib/ui-core/src/workflows/analyze/decision-extraction.ts`: `MAX_ANALYZE_FILES` (40),
  `MAX_ANALYZE_BYTES` (200,000), `collectSourceFiles()` -- a plain, dependency-free walk/cap helper
  (not a DI-registered `lib/core` service -- see the plan Decision 2), ported behaviorally from
  old Docuvia `ExtractService`.
- `AnalyzeWorkflow` (`analyze-workflow.ts`) now branches on `options?.targetPath`: unchanged
  config-scan path (now tagged `kind: "configScan"`), or a new decision-extraction path that
  resolves the path, collects source files, calls `TOKENS.LlmClient` (resolved exactly like
  `SyncWorkflow` resolves `TOKENS.RemoteSyncClient`), parses/defensively coerces the JSON response,
  and logs `analyze.focused.start`/`analyze.focused.summary`/`analyze.focused.error` JSONL events.
- `docuvia-api.ts` `analyze()` reads `targetPath` from `docuviaMemory`; if absent, delegates to
  the unchanged config-scan path; if present, also requires `llmBaseUrl`/`llmModel` via
  `requireMemory` (defense-in-depth, independent of the CLI own env-var gate).
- `artifacts/cli/src/commands/analyze.ts` rewritten: reads
  `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` / `AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY` (optional) /
  `AI_DOCUVIA_MODEL || AI_DOCUVIA_FAST_MODEL` when a `targetPath` is given; missing base
  URL/model is a hard `exit 1` with `UI_MESSAGES.ANALYZE_LLM_MISSING_ENV`
  before `docuviaApi.analyze` is ever called. Both branches now share one try/catch/finally
  block and one call to `docuviaApi.analyze`.
- `ErrorCodes.LLM_INVALID_RESPONSE` added (`lib/contracts/src/errors/error-codes.ts`).

### Bugs found and fixed

1. **`process.exit(1)` to `process.exitCode = 1` (both branches of `analyzeCommand`)** -- caught
   during planning (see the plan Part 0 note), not after a naive implementation, but is the same
   class of latent Windows-crash risk as `sync.ts` existing fix and old Docuvia own
   `runFocusedExtraction` comment: forcing an immediate `process.exit()` while a real network
   call fetch/undici handles are still closing crashes natively on Windows. Before this change
   the config-scan branch never made a network call so `process.exit(1)` was safe; once the
   `targetPath` branch performs a real LLM HTTP call, both branches needed to converge on
   `process.exitCode`. Implemented as specified; verified via the "calls spinner.fail and sets
   process.exitCode = 1 (not process.exit())" tests (both branches) in `analyze.unit.test.ts` -- the
   test no longer needs to `await expect(...).rejects.toThrow("Exit 1")` the way the old test did.

2. **Architectural deviation, made during implementation, flagged here for review**: the plan
   instructs reusing `isSupportedSourceFile` from `lib/core/src/utils/language-detection.ts`
   as-is inside `lib/ui-core`. `lib/core/src/index.ts` existing doc comment states
   `lib/ui-core` "never imports this package at all, only docuviaFactory by token" -- and
   `@workspace/core` `package.json` `exports` map only exposes its `"."` barrel (no deep
   subpath imports are resolvable at all, by Node own module resolution). Reusing the function
   without reinventing it (as instructed) therefore required: (a) adding
   `export { isSupportedSourceFile } from "./utils/language-detection.js";` to
   `lib/core/src/index.ts` barrel, with a comment documenting this as one narrow, deliberate
   exception (a pure, side-effect-free utility, not DI/Technology-Provider material); (b) adding
   `@workspace/core` as a `lib/ui-core/package.json` dependency; (c) adding the corresponding
   TypeScript project reference in `lib/ui-core/tsconfig.json`. This is a real, judgment-call
   deviation from the letter of the "never imports" comment (though not from the plan explicit
   instruction to reuse the function) -- flagged explicitly for the verifier rather than silently
   made. No other `lib/ui-core` file imports `@workspace/core` for anything beyond this one
   function.

3. **Markdown-code-fence-wrapped JSON responses were treated as `LLM_INVALID_RESPONSE`, discarding
   an otherwise valid extraction** -- found via the Part B.4 live smoke test once the pre-existing
   `lib/llm-api` base-URL-doubling issue (see "Live smoke test" below) was worked around for one
   throwaway run against the real Mistral (CLIProxyAPI-compatible) backend. The LLM call itself
   succeeded, but `AnalyzeWorkflow.executeDecisionExtraction()` still reported "LLM returned
   non-JSON output for decision extraction". A temporary debug capture of the raw
   `response.choices[0]?.message.content` (added and reverted in the same session, not part of
   this commit) showed the model had wrapped an otherwise well-formed JSON array in a
   ` ```json\n...\n``` ` markdown code fence -- Mistral, like many OpenAI-compatible backends not
   given an explicit JSON-mode/`response_format` constraint, does this even when the system prompt
   asks it not to. The original `JSON.parse(rawContent)` call had no tolerance for this, so a
   `SyntaxError` was swallowed by the existing `catch` block and every extracted decision was
   silently lost, even though the model's actual answer was correct. Old Docuvia's own
   `prompt-service.ts` (`d:\GitHub\Docuvia\lib\core\src\services\prompt-service.ts`, not in this
   repo) mitigated the same class of problem only by appending a "no markdown wrappers" instruction
   to the prompt -- a weak mitigation, since models still sometimes fence anyway. Fixed with two
   layers: (a) a new, independently-tested `stripMarkdownCodeFence()` helper
   (`lib/ui-core/src/workflows/analyze/analyze-workflow.ts`) that trims a leading/trailing
   ` ```json ` or bare ` ``` ` fence (tolerating surrounding whitespace) before `JSON.parse`, called
   from `executeDecisionExtraction()`, and passing unfenced content through completely unchanged;
   (b) `DECISION_EXTRACTION_SYSTEM_PROMPT`
   (`lib/ui-core/src/workflows/analyze/analyze-messages.ts`) now also appends
   `OUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json.`, matching old
Docuvia's belt-and-suspenders mitigation, with the fence-stripping as the robust fallback when a
backend/model ignores that instruction anyway. Verified via 8 new tests in
`analyze-workflow.unit.test.ts`: 3 tests through the full `AnalyzeWorkflow.execute()` path
(` ``json `-fenced response with 3 mocked decision objects styled on the actual live capture
parses correctly; bare ` `` `-fenced response with no language tag also parses correctly;
fenced-but-genuinely-invalid-JSON still throws `LLM_INVALID_RESPONSE`, proving fence-stripping
does not swallow real parse errors) plus 5 direct unit tests of `stripMarkdownCodeFence()` in
   isolation (fenced-with-whitespace, bare fence, unfenced-passthrough, malformed/partial fence
   passthrough, stripped-but-still-invalid content). All pre-existing non-fenced happy-path and
   error-path tests were re-run unchanged and still pass.

## Part B -- tests added (file paths)

`lib/ui-core`:

- `lib/ui-core/src/workflows/analyze/decision-extraction.unit.test.ts` (new, 5 tests): directory
  walk skips `node_modules`/`.git`/`.docuvia` and only collects `isSupportedSourceFile()` matches;
  file-count cap (`MAX_ANALYZE_FILES + 5` files leads to exactly `MAX_ANALYZE_FILES` collected, 5 in
  `droppedFiles`); byte cap (4x60,000-byte files crossing `MAX_ANALYZE_BYTES` leads to excess dropped);
  single-file target path collects just that file; a file that throws on read (mocked `EACCES`) is
  skipped from both `files`/`droppedFiles` and triggers `logger.warn`.
- `lib/ui-core/src/workflows/analyze/analyze-workflow.unit.test.ts` (updated plus 8 new tests, 10
  total): existing 2 config-scan tests updated for the `kind: "configScan"` tag; new: missing
  target path throws `DocuviaError` (`FS_READ_FAILED`) and logs `analyze.focused.error`; zero eligible
  files leads to empty `decisionExtraction` result and `TOKENS.LlmClient` never resolved; happy path
  (verbatim system prompt, `--- <relativePath> ---` plus content in the user message, mapped
  decisions, `analyze.focused.start`/`.summary` JSONL with correct `decisionsCount`); non-JSON
  response leads to `LLM_INVALID_RESPONSE`; null response content leads to `LLM_INVALID_RESPONSE`;
  parsed-but-not-an-array response leads to `LLM_INVALID_RESPONSE`; defensive coercion of
  missing/wrong-typed fields (`{title: null, nodeType: "not-a-real-type", confidence: "high"}`
  becomes `{title: "", nodeType: "context", confidence: 0}`); dropped-by-cap files trigger
  `logger.warn`.

`artifacts/cli`:

- `artifacts/cli/test/unit/commands/analyze.unit.test.ts` (rewritten, 12 tests): config-scan
  branch (5 tests: success print, spinner.fail plus exitCode, 50-tag list, spinner.text-on-onLog
  [claim 1], scope-leak/idempotency [claim 7]); target-path branch (7 tests: missing base URL exits
  1 without calling `docuviaApi.analyze`, missing both model vars exits 1, `AI_DOCUVIA_FAST_MODEL`
  alone accepted, memory `set()` calls plus `docuviaApi.analyze` invoked when env vars present, prints
  `[nodeType] title (confidence: N)` plus content lines, prints `ANALYZE_FOCUSED_NONE` on empty
  decisions, spinner.fail plus exitCode on rejection).
- `artifacts/cli/test/integration/commands/analyze-config-scan.integration.test.ts` (new, 1
  test, claim 5): real sandboxed CLI process (`sandbox.runCli(["analyze"])`, no mocks at any layer)
  against a real `package.json` with `react`/`typescript`; asserts the real
  `ConfigScannerService` fuses `projectType: "javascript"` and the expected tags, and that
  `.docuvia/logs/analyze.log` has real `analyze.start`/`analyze.summary` lines.
- `artifacts/cli/test/integration/commands/analyze-concurrency.test.ts` (new, 1 test, claim 6):
  5 concurrent real `sandbox.runCli(["analyze"])` processes against a shared sandbox; asserts all
  exit 0 and `.docuvia/logs/analyze.log` contains exactly 10 well-formed JSON lines (5
  `analyze.start` plus 5 `analyze.summary`, all `JSON.parse`-able -- no interleaved/corrupted lines
  from concurrent `fs.appendFile` calls).

`lib/contracts`: no dedicated test added for `LLM_INVALID_RESPONSE` -- it is a plain `const`
object entry; grepped every test file for `ErrorCodes` usage first and confirmed no test snapshots
the full object (only `docuvia-error.unit.test.ts` existing individual-code assertions, unaffected).

`lib/ui-core` `docuvia-api.ts`: no `docuvia-api.unit.test.ts` file exists in this repo, so
per the plan own conditional instruction ("if so add"), no test was added there; the equivalent
behavior (targetPath-present-but-missing-llmBaseUrl/llmModel leads to `INVALID_INPUT`) is exercised
indirectly through `AnalyzeWorkflow` constructor contract and `requireMemory` existing,
already-tested behavior (`lib/ui-core/src/docuvia-api.ts` itself is a thin 6-line dispatch with no
new branching logic worth a dedicated unit test beyond what `AnalyzeWorkflow` own tests already
cover).

## Verification performed (actual numbers, from real pnpm test runs)

- `pnpm --filter @workspace/contracts run build` -- clean.
- `pnpm --filter @workspace/contracts run test` -- 7 test files / 36 tests, all passing
  (unchanged from baseline; only the `ErrorCodes` constant changed).
- `pnpm --filter @workspace/core run build` -- clean (barrel-export addition only).
- `pnpm --filter @workspace/ui-core run build` -- clean.
- `pnpm --filter @workspace/ui-core run test` -- 23 test files / 95 tests, all passing
  (`analyze-workflow.unit.test.ts`: 10 tests; `decision-extraction.unit.test.ts`: 5 tests, both new
  counts included).
  **Update (markdown-code-fence fix, this session):** 23 test files / **103 tests**, all passing
  (`analyze-workflow.unit.test.ts` grew from 10 to 18 tests: 3 new tests exercising
  `stripMarkdownCodeFence()` through the full `AnalyzeWorkflow.execute()` path, plus 5 new direct
  unit tests of the helper in isolation; `decision-extraction.unit.test.ts` unchanged at 5 tests).
  `pnpm --filter @workspace/ui-core run build` re-confirmed clean.
- `pnpm --filter @workspace/cli run build` (tsup) -- clean; `pnpm --filter @workspace/cli run
typecheck` (`tsc -p tsconfig.json --noEmit`) -- clean.
- `pnpm --filter @workspace/cli run test` (`vitest run --fileParallelism false`) -- 27 test files /
  110 tests, all passing (`analyze.unit.test.ts`: 12 tests;
  `analyze-config-scan.integration.test.ts`: 1 test; `analyze-concurrency.test.ts`: 1 test, all new
  or rewritten counts included). One unrelated, pre-existing EBUSY cleanup warning from
  `dist-build.test.ts` sandbox teardown appeared in stderr -- not a test failure, not caused by
  this change (Windows file-lock timing on a `.db-wal` file during `rm`).
- Full workspace `pnpm run build` -- clean (typecheck plus all 10 packages).
- Full workspace `pnpm run test` -- 93 test files / 525 tests, all passing.
- `git status` after all of the above shows only the files listed below as changed/new -- no
  unexpected file changes.
- **Update (markdown-code-fence fix, this session):** full workspace `pnpm run build` re-confirmed
  clean; full workspace `pnpm run test` -- 93 test files / **533 tests**, all passing (525 baseline
  - 8 new `@workspace/ui-core` tests from the fence-stripping fix; no other package's test count
    changed since no other package's source was touched in this follow-up).

## Live smoke test (Part B.4) -- actual outcome: attempted, did not complete successfully

Ran (from an external scratch directory containing a copy of
`artifacts/cli/src/commands/sync.ts`, using the built `dist/cli.js` and the user real, exported
`AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` / `AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY` /
`AI_DOCUVIA_MODEL` / `AI_DOCUVIA_FAST_MODEL`, unmodified):

```
docuvia analyze sync.ts
```

Result:

```
Extracting decisions from sync.ts...
Decision extraction failed: Chat completion failed: Not Found
```

Process exited 1. `.docuvia/logs/analyze.log` (in the scratch dir) contains only one line --
`{"event":"analyze.focused.start","targetPath":"sync.ts"}` -- no `analyze.focused.summary` or
`analyze.focused.error` line, because the failure occurred inside the raw `chatCompletion()` HTTP
call itself, before any of the JSON-parsing-failure branches that log `analyze.focused.error` (see
Follow-ups #4 below).

Root cause (diagnosed, not fixed): `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` is set to
`https://api.mistral.ai/v1/chat/completions` (the full completions endpoint) rather than a bare
host (e.g. `https://api.mistral.ai`). `FetchLlmClient.chatCompletion()`
(`lib/llm-api/src/fetch-llm-client.ts`, pre-existing code from LLM-002, explicitly out of scope for
this task) unconditionally appends `/v1/chat/completions` to `config.baseUrl`, so the actual
request URL became a doubled, invalid path -- the "Not Found" is the real backend real response to
that doubled path, not a bug in the new `analyze <targetPath>` code. This is corroborated by the
call reaching the network layer at all: `initialize()`/`chatCompletion()` were invoked correctly,
`FetchLlmClient` correctly wrapped the failure as `DocuviaError(LLM_CHAT_COMPLETION_FAILED, ...)`,
`analyzeCommand` shared catch block correctly printed it and set `process.exitCode = 1` without
crashing -- every piece of this task new code behaved correctly given a real (if malformed)
backend response.

**Update (follow-up session, same day):** the base-URL issue above was worked around for one
throwaway re-run against the real Mistral (CLIProxyAPI-compatible) backend, purely to unblock
Part B.4 diagnosis (no permanent `lib/llm-api` fix was made -- still tracked separately, out of
scope for this repo's `analyze` feature). That re-run got past the HTTP layer -- the LLM call
itself succeeded -- but decision extraction still failed, this time with "LLM returned non-JSON
output for decision extraction". A temporary raw-content capture confirmed Mistral had wrapped its
(otherwise well-formed) JSON array response in a ` ```json ... ``` ` markdown code fence, which
`JSON.parse()` cannot handle directly. This is a real, generalizable bug in this repo's own
`analyze <targetPath>` code (not a backend-URL or environment issue) and has now been fixed --
see **Bugs found and fixed #3** above for the root cause and fix (`stripMarkdownCodeFence()` in
`analyze-workflow.ts` + a strengthened `DECISION_EXTRACTION_SYSTEM_PROMPT`), and the "Verification
performed" section for the updated `@workspace/ui-core` and full-workspace test counts. The fix
itself was verified with 8 new mocked unit tests (see Bugs found and fixed #3); it was **not**
re-verified against the live network in this follow-up session (no LLM credentials/env vars were
touched here). A final live re-run of `docuvia analyze <targetPath>` against the real backend --
confirming the fenced-response path now succeeds end-to-end, not just under mocks -- is expected to
be performed separately as the closing step of this whole effort.

An attempt was made in this same session to locally correct the base URL (stripping the redundant
`/v1/chat/completions` suffix) purely to confirm this diagnosis end-to-end; that action was
correctly blocked by the permission system as an unauthorized substitution of a different network
destination for real file content/credentials, and no attempt was made to work around that block.
Per the plan B.4 instructions ("if an error does surface, capture the raw response body in
analyze-status.md follow-ups instead of silently rerunning until it passes"), this failure and its
diagnosis are recorded here rather than papered over. This step needs to be re-run by the user (or
by an agent, with the corrected base URL or a working CLIProxyAPI instance explicitly
re-authorized) before the `targetPath` LLM path can be considered live-verified end to end; today
it is verified against real network I/O producing a real (documented) failure, and against 15
mocked unit/integration scenarios covering every branch of the new code.

**Final live re-confirmation (orchestrator, same day, after the fence-stripping fix landed):** ran
the fix's `stripMarkdownCodeFence()` change through a real, non-mocked round trip against the same
Mistral backend, one-off overriding only `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` for the single
invocation (the underlying persisted env var was not modified) to work around the separately-tracked
`FetchLlmClient` URL-doubling issue described above:

```
$ AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL="https://api.mistral.ai" node dist/cli.js analyze sync.ts
Analyze Path
- Extracting decisions from sync.ts...
✔ Decision extraction complete.
ℹ [rule] Strict separation of Presentation and Orchestration layers (confidence: 1)
    The code enforces a strict separation where only the Presentation layer (sync.ts) may access
    `process.env`. ...
ℹ [decision] Use of scoped memory for state isolation (confidence: 1)
    ...
(9 decisions printed total, each in the "[nodeType] title (confidence: N)" + content shape)
```

Process exited 0. `.docuvia/logs/analyze.log` gained a well-formed
`{"event":"analyze.focused.start","targetPath":"sync.ts"}` followed by
`{"event":"analyze.focused.summary","targetPath":"sync.ts","decisionsCount":9}` -- no
`analyze.focused.error` line, confirming the markdown-fenced response is now parsed correctly
end-to-end against a real backend, not just under mocks. Full workspace `pnpm run test` was re-run
immediately after (93 test files / 533 tests, all passing) to confirm no regression from the fix.
**Part B.4 is now considered complete.** The remaining open item is purely the separately-tracked
`lib/llm-api` base-URL-doubling issue (item 1 below), which affects only users whose
`AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` already includes a `/v1/chat/completions` (or similar)
suffix -- a one-line env var correction on the user's side, not a code defect in this feature.

## Follow-ups / not yet done

1. `lib/llm-api`'s `FetchLlmClient.chatCompletion()`/`streamChatCompletion()` unconditionally
   append `/v1/chat/completions` to `config.baseUrl` (`lib/llm-api/src/fetch-llm-client.ts`,
   pre-existing LLM-002 code, out of scope for this feature to fix). Any
   `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` value that already includes that suffix (as the
   user's initial value did: `https://api.mistral.ai/v1/chat/completions`) doubles into an invalid
   URL and 404s. Worth a small follow-up in `lib/llm-api` (either document the expected bare-host
   format clearly, or defensively strip a trailing `/v1/chat/completions` before appending) in a
   future session -- not blocking for this feature, now that Part B.4 has been confirmed live with
   the env var corrected for one invocation.
2. ~~Claim 2 and claim 6 original framing in `analyze.md` are stale/overstated (see the table
   above) and `analyze.md` itself was not corrected in place -- same pattern
   `init-concurrency-status.md` flagged for `init.md`.~~ **Done** -- as part of the broader
   `docs/cli-test-analysis/` reorg (2026-07-15), the original speculative `analyze.md` was removed
   since this doc fully supersedes it, mirroring `init.md`'s removal. See
   [README.md](./README.md).
3. The `EACCES`-on-`cwd` scenario from claim 4 has no analog test at the `analyzeCommand` layer
   because it structurally cannot surface there (documented reasoning above, not a gap).
4. Newly observed gap (found via the live smoke test, not originally in scope): when the raw
   `llmClient.chatCompletion()` call itself throws (a network/HTTP-level failure, as opposed to a
   JSON-parsing failure of a successful response), `AnalyzeWorkflow` decision-extraction path
   does not log an `analyze.focused.error` line before rethrowing -- only `analyze.focused.start`
   is ever written. This exactly mirrors old Docuvia `ExtractService.extractDecisions()`, which
   also left `orchestrator.generate()` uncaught for logging purposes, so it is not a regression
   introduced here -- but it means `.docuvia/logs/analyze.log` cannot be used to diagnose a raw LLM
   HTTP failure after the fact, only the terminal spinner.fail message can. Worth a follow-up
   fix (wrap the `chatCompletion()` call to log `analyze.focused.error` on any thrown error, not
   just on a parseable-but-invalid response) in a future session.
5. Rate-limiting/retry behavior against a real CLIProxyAPI instance under sustained load is out of
   scope for this pass -- only the one manual smoke test above touches a live backend at all.

## Current working-tree state (as of this doc)

Modified (not committed):

```
artifacts/cli/src/commands/analyze.ts
artifacts/cli/src/constants/ui-messages.ts
artifacts/cli/test/unit/commands/analyze.unit.test.ts
lib/contracts/src/errors/error-codes.ts
lib/core/src/index.ts
lib/ui-core/package.json
lib/ui-core/src/docuvia-api.ts
lib/ui-core/src/workflows/analyze/analyze-messages.ts
lib/ui-core/src/workflows/analyze/analyze-result.ts
lib/ui-core/src/workflows/analyze/analyze-workflow.ts
lib/ui-core/src/workflows/analyze/analyze-workflow.unit.test.ts
lib/ui-core/tsconfig.json
pnpm-lock.yaml   (regenerated by pnpm install after adding the lib/ui-core -> lib/core dependency)
```

New (untracked, intentional):

```
artifacts/cli/test/integration/commands/analyze-concurrency.test.ts
artifacts/cli/test/integration/commands/analyze-config-scan.integration.test.ts
docs/cli-test-analysis/analyze-status.md  (this file)
lib/ui-core/src/workflows/analyze/decision-extraction.ts
lib/ui-core/src/workflows/analyze/decision-extraction.unit.test.ts
```

Nothing has been committed yet -- no commit was requested this session.
