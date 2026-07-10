# Fix: `docuvia init` Honest Success Reporting + Observability

**Status**: Ready for implementation
**Author**: requirement-analyzer
**Date**: 2026-07-10
**Source audit**: [`docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md`](../analysis/docuvia-cli-vs-gitnexus-2026-07-10.md), section `docuvia init` (lines 38-61), cross-cutting `pino-pretty` issue (lines 18-34), priority recommendation #3 (line 276).

---

## 1. Interpretation of the Requirement

The project owner reviewed a findings-only audit and scoped exactly three things to `init` (explicitly **not** the other stubbed commands like `review`/`sync`/`analyze <path>`, which are out of scope for this plan):

1. **Observability**: replace vanishing `console.*` calls with structured, persisted logs an AI agent can read back after the run to verify what actually happened.
2. **Honesty**: stop `init` from printing `✔ Project initialized successfully` when files silently failed to parse.
3. **Regression coverage**: add tests, top to bottom, that reproduce the *real* observed failure (`AstWorkerPool` worker crash mid-scan), not just happy-path mocks.

This is a data-integrity bug, not a missing-feature stub (contrast with `review`/`sync`, which are honest about doing nothing — `init` is dishonest about having succeeded). The fix is a **plumbing** problem: failure information already exists at the point of occurrence (worker crash, `res.success === false`) and is discarded at three sequential layers before it ever reaches the user. The fix is to thread it through, not to add new failure-detection logic.

I traced the full call graph and confirmed all line references in this document by reading the current source directly (not solely trusting the audit) as of 2026-07-10. Confirmed additional facts the audit didn't need to state:

- `AstWorkerPool` and `AstProcessingService` both live in `@workspace/core` (`lib/core/src/services/`), **not** `@workspace/ast-core` — the worker source `ast-worker.ts` is at `lib/core/src/workers/ast-worker.ts`. `lib/ast-core` is a separate package that only owns `language-registry.ts` / `parser-core.ts` / the tree-sitter grammar plumbing.
- `IAstProcessor.processFiles()` has exactly **two** implementers in the codebase today: `AstProcessingService` (the real one) and the mocked interface satisfied ad hoc in `lib/core/src/services/init-service.unit.test.ts`. It has exactly **two** call sites: `InitService.init()` (`lib/core/src/services/init-service.ts:94`) and `artifacts/cli/src/commands/snapshot.ts:32` (`snapshotCommand`, used directly, not via DI). Both must be updated together since this document changes the interface's return shape.
- `lib/core/src/constants/init-service-messages.ts` already exists with an `INIT_SERVICE_MESSAGES` constants object (`SUCCESS: "Project initialized successfully"`, etc.) but `init-service.ts` doesn't currently import or use it — it has inline string literals instead. This is a pre-existing inconsistency (likely from the `f6c7e2a refactor(core): extract magic strings to constants` commit not having been threaded all the way through). This plan brings `init-service.ts` onto that constants file rather than adding a second, parallel set of inline strings, since a partial-failure success message needs to live somewhere and duplicating the pattern would make it worse.
- `pino@9.14.0` is the installed version (`lib/core/package.json`). Its `pino.destination()` file-sink API is a **synchronous, in-process** writable stream — architecturally distinct from `transport: { target: "pino-pretty" }`, which spawns a **worker thread** to load the transport module and is the literal cause of the `tsx`/ESM resolution crash. This distinction matters for the logging fix below: reusing more worker-thread transport machinery to fix an observability gap would risk reintroducing the same class of bug it's meant to fix.
- No other file in the repo currently uses `pino.destination()` or a file transport — this is new territory, not an existing pattern to copy, so the design below is deliberately conservative (plain destination stream, no rotation, no external dependency).
- `DOCUVIA_DIR_NAME = ".docuvia"` (`lib/core/src/constants/paths.ts:2`) and the `.docuvia/tmp/` convention (`temp-file-manager.ts:38`) establish the precedent for scoped runtime state under the workspace root; a `.docuvia/logs/` directory following the same convention is a natural fit and requires no new top-level constant beyond one new path segment.

---

## 2. Implementation Goals (Verifiable)

| # | Goal | Verifiable Success Criterion |
|---|------|-------------------------------|
| G1 | `docuvia init` never prints an unqualified green "success" when any file failed to parse. | Running `init` against a fixture where N of M files are forced to fail produces CLI output containing the literal failure count (`N`) and does not contain the exact string `"Project initialized successfully"` unqualified. |
| G2 | Every AST parse failure (worker crash or `res.success === false`) is attributable to a specific file path in the returned data structure. | `AstProcessingService.processFiles()`'s return value contains a `failures` array where each entry's `file` field matches a real input file path, verified by a test that crashes one specific worker mid-batch. |
| G3 | A structured, persisted log exists after every `init` run that an agent can read via the `Read` tool (not stdout capture) to determine pass/fail per file. | `.docuvia/logs/init.log` exists after any `init` invocation and contains a final JSON line with `event: "init.summary"`, `filesRequested`, `filesParsed`, `filesFailed`, and a `failures[]` array with `file`/`error` per entry. |
| G4 | The CLI does not crash on startup outside `NODE_ENV=production` (prerequisite — without this, G3's logger-based writes are unreachable in normal dev/CI use). | `pnpm --filter @workspace/cli exec tsx src/cli.ts --help` (no `NODE_ENV` override) exits 0 and prints usage, with no `unable to determine transport target for "pino-pretty"` error. |
| G5 | `docuvia snapshot` (the other consumer of `AstProcessingService`) continues to work after the `IAstProcessor` interface change — no silent break of the sibling command. | `snapshot.ts` compiles against the new return shape and its existing behavior (nodes/links counted from `parsedResults`) is unchanged for the all-success case, verified by `snapshot.unit.test.ts`. |
| G6 | Regression tests exist that reproduce the actual observed failure mode (worker crash mid-batch across many files), not just a single trivially-failing mock. | New/updated unit tests in all four layers below pass, each asserting on the specific real error text/shape seen in the audit (`"Worker exited with code 1"`, `res.success === false` with populated `error`). |

---

## 3. Approach / Methodology

Four layers, addressed bottom-up so each layer's tests can rely on the layer beneath it already being correct:

```
ast-worker-pool.ts  →  ast-processing.service.ts  →  init-service.ts  →  init.ts (CLI)
  (attribute crash        (collect failures,           (compare counts,      (print honest
   to filePath)             don't drop them)             set partialFailure)   summary + read log)
        │                         │                            │
        └── logger.ts fix (prerequisite, unblocks structured writes at every layer above)
```

Plus one cross-cutting, lower-priority cleanup (`language-registry.ts` bare `console.debug`) folded in because it touches the same "un-gated console output" theme and is a one-line fix directly adjacent to the worker-crash noise already being addressed.

---

## 4. Detailed Implementation Steps

### Step 0 (prerequisite) — Fix `pino-pretty` crash under `tsx`

**File**: `lib/core/src/utils/logger.ts`

**Problem** (confirmed by reading lines 31-39): `transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty", ... } : undefined` unconditionally tries to spawn the `pino-pretty` worker-thread transport in every non-production run, and that resolution throws under `tsx`'s ESM loader before the CLI does anything else.

**Decision — recommended approach**: Default pretty-printing to **off**, gated behind an explicit opt-in env var (`DOCUVIA_PRETTY_LOGS=1`), and wrap the transport creation so a resolution failure degrades to plain JSON stdout instead of crashing the process. Concretely:

```ts
import { pino } from "pino";

const wantsPretty = process.env.DOCUVIA_PRETTY_LOGS === "1";

function buildTransport() {
  if (!wantsPretty) return undefined;
  try {
    // Resolve eagerly so a broken/unresolvable pino-pretty fails fast into the catch
    // below instead of surfacing asynchronously from inside pino's worker thread.
    require.resolve("pino-pretty");
    return { target: "pino-pretty", options: { colorize: true } };
  } catch {
    console.warn("[docuvia] pino-pretty unavailable, falling back to plain JSON logs.");
    return undefined;
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: { /* unchanged */ },
  transport: buildTransport(),
});
```

Why this over the alternatives:
- *Alternative A (resolve `pino-pretty`'s absolute path explicitly and pass it as `target`)* — the audit's own suggested fix. Rejected as the primary fix because the underlying failure is inside `pino`'s worker-thread module resolution under `tsx`, which passing an absolute path does not reliably fix in all `tsx`/Node version combinations (worker threads spawned by `pino` still re-run their own ESM resolution). It's a narrower, more fragile fix than simply not spawning a worker thread by default.
- *Alternative B (always JSON, remove pretty-printing entirely)* — safest, but regresses local developer UX (colorized readable logs) with no opt-in path back. Rejected in favor of the env-var gate, which preserves the capability for anyone who wants it (e.g., `DOCUVIA_PRETTY_LOGS=1 docuvia init`) while making the default safe.
- **Recommended: the env-var-gate + fail-soft try/catch shown above.** Default behavior changes from "crash" to "plain JSON to stdout," which is a strict improvement and requires no new dependency.

**Verification (G4)**: run `pnpm --filter @workspace/cli exec tsx src/cli.ts --help` with no `NODE_ENV` set; must exit 0. Add `lib/core/src/utils/logger.unit.test.ts` (new file) with:
- `it("does not throw when DOCUVIA_PRETTY_LOGS is unset and NODE_ENV is not production")` — imports `logger.ts` in a subprocess or via `vi.resetModules()` + re-import with env vars set, asserts no throw.
- `it("falls back to plain logging if pino-pretty resolution fails")` — mock `require.resolve` (or `module.createRequire`) to throw, assert `buildTransport()` returns `undefined` and a warning is printed, not an exception.

---

### Step 1 — Attribute worker crashes to the in-flight file (`AstWorkerPool`)

**File**: `lib/core/src/services/ast-worker-pool.ts`

**Problem** (confirmed at lines 65-96): `handleError` has `taskId` (via `this.workerTasks.get(worker)`, line 68) but never had the original `filePath` — `parse()`'s `request.filePath` (line 31 caller-side, i.e. `ast-processing.service.ts:31`) is only ever passed into `worker.postMessage()` (line 213) and is not retained anywhere keyed by `taskId`.

**Change**:
1. Add a new map: `private taskFilePaths = new Map<string, string>();`
2. In `processQueue()` (line ~197, right after `const taskId = String(++this.taskCounter);`), add: `this.taskFilePaths.set(taskId, task.request.filePath);`
3. In the `worker.on("message", ...)` success handler (line 48-63), after `this.pendingTasks.delete(res.taskId)`, add `this.taskFilePaths.delete(res.taskId);` (cleanup on the success path too, so the map doesn't grow unbounded across a long-lived pool).
4. In `handleError` (line 65), after computing `taskId` (line 68) and before rejecting (line 77), look up `const filePath = taskId ? this.taskFilePaths.get(taskId) : undefined;` and clean it up (`this.taskFilePaths.delete(taskId)`).
5. Export a new error class from this file so callers can pattern-match on it reliably instead of parsing error message strings:
   ```ts
   export class AstWorkerCrashError extends Error {
     constructor(public readonly filePath: string | undefined, public readonly cause: unknown) {
       super(
         `AST worker crashed while parsing ${filePath ?? "(unknown file)"}: ` +
         (cause instanceof Error ? cause.message : String(cause))
       );
       this.name = "AstWorkerCrashError";
     }
   }
   ```
   Reject with `callbacks.reject(new AstWorkerCrashError(filePath, timedOut ? new Error(`... timed out after ${this.taskTimeoutMs}ms`) : err))` instead of the current bare `err`/timeout-`Error`.
6. Also route the `console.error("[AstWorkerPool] Worker crashed/exited:", err)` (line 67) and the timeout `console.error` (line 204-206) through `logger.error({ taskId, filePath }, "AST worker crashed/exited")` — this file already imports `logger` (line 9) but never uses it for the crash path, only for `logger.debug`/`logger.info` on the cache-hit/metrics paths (lines 150, 171). This directly feeds G3 (the structured summary log needs per-file crash events, not just the final rollup).

**Verification (G2, G6)**: extend `lib/core/src/services/ast-worker-pool.unit.test.ts` with:
- `it("attributes a worker crash to the specific file being parsed, not an adjacent one")`: initialize a pool with `workerCount: 1` (deterministic — one worker, one task in flight at a time), submit a parse request for a fixture file engineered to crash the worker (e.g., a payload that causes the underlying tree-sitter binding to throw synchronously inside the worker, or — more reliably and without depending on parser internals — a test-only worker script swapped in via constructor injection that `process.exit(1)`s when it sees a sentinel `filePath`). Assert the rejection is `instanceof AstWorkerCrashError` and `error.filePath === "the-crashing-file.ts"`.
- `it("respawns a worker after a crash and continues serving subsequent tasks")` (regression guard for the existing respawn behavior at line 94, currently untested): after the crash above, submit a second, healthy parse request and assert it still resolves successfully — proves the pool recovers, matching the audit's observation that the pool *does* respawn (13 crashes, but the run still completed).
- `it("does not leak taskFilePaths entries across successful parses")`: submit 3 successful parses sequentially, assert `(pool as any).taskFilePaths.size === 0` afterward.

To reliably force a crash without flaky reliance on parser internals, the test should inject a **fake worker script path** via a small constructor/test-seam addition — check whether `AstWorkerPool`'s constructor needs a 4th optional param (e.g., `private workerScriptPathOverride?: string`) purely for test injection, defaulting to the existing `wPath` resolution logic (lines 108-115) when unset. This is the single small, additive, test-only surface change permitted in this otherwise pure-observability fix; flag it to `backend-developer` as a design choice to confirm during implementation rather than mandate a specific mechanism — a `worker.terminate()`-from-within-a-fixture-file approach is an acceptable alternative if it proves simpler.

---

### Step 2 — Stop dropping failures in `AstProcessingService.processFiles()`

**File**: `lib/core/src/services/ast-processing.service.ts`
**File**: `lib/core/src/interfaces/analyzer.interfaces.ts` (interface change — breaking, both implementers/consumers must move together)

**Problem** (confirmed at lines 28-43): both the `catch` branch (worker crash / rejection, line 40-42) and the `else` branch (`res.success === false`, line 37-39) only log and continue; the failed file is never captured in any return value. `IAstProcessor.processFiles()`'s declared return type, `Promise<ParsedAstFileResult[]>`, structurally has no room for failures.

**Interface change**:

```ts
// analyzer.interfaces.ts
export interface AstParseFailure {
  file: string;
  hash: string;
  error: string;
}

export interface AstProcessResult {
  parsed: ParsedAstFileResult[];
  failures: AstParseFailure[];
}

export interface IAstProcessor {
  processFiles(
    workspaceRoot: string,
    filesToParse: DiscoveredFile[]
  ): Promise<AstProcessResult>;
}
```

**Service change**:

```ts
// ast-processing.service.ts
public async processFiles(
  workspaceRoot: string,
  filesToParse: DiscoveredFile[]
): Promise<AstProcessResult> {
  // ...unchanged setup...
  const parsedResults: ParsedAstFileResult[] = [];
  const failures: AstParseFailure[] = [];
  const batchSize = 50;
  for (let i = 0; i < filesToParse.length; i += batchSize) {
    const batch = filesToParse.slice(i, i + batchSize);
    const promises = batch.map(async (item) => {
      try {
        const res = await pool.parse({ filePath: item.file, code: item.code, language: getLanguage(item.file) });
        if (res.success && res.data) {
          parsedResults.push({ file: item.file, hash: item.hash, data: res.data });
        } else {
          const error = res.error ?? "parse returned success=false with no error detail";
          logger.warn({ file: item.file, error }, "AST parse returned failure result");
          failures.push({ file: item.file, hash: item.hash, error });
        }
      } catch (e) {
        const error = e instanceof AstWorkerCrashError ? e.message : e instanceof Error ? e.message : String(e);
        logger.error({ file: item.file, error }, "AST parse threw (worker crash or rejection)");
        failures.push({ file: item.file, hash: item.hash, error });
      }
    });
    await Promise.all(promises);
  }

  await pool.terminate();
  return { parsed: parsedResults, failures };
}
```

Replace the two bare `console.log`/`console.warn` calls (lines 38, 41) with `logger` calls as shown — this file currently imports neither `logger` nor any error type from `ast-worker-pool.ts`; both imports need to be added.

**Consumers to update (both, in the same change — G5)**:
1. `lib/core/src/services/init-service.ts:94-104` — `const parsedResults = await this.astProcessor.processFiles(...)` becomes `const { parsed: parsedResults, failures } = await this.astProcessor.processFiles(...)`; the rest of the loop (`for (const result of parsedResults)`, line 98) and `persistAstGraph(..., parsedResults, ...)` (line 104) keep using `.parsed`'s contents (renamed locally), unchanged otherwise.
2. `artifacts/cli/src/commands/snapshot.ts:32` — `const parsedResults = await astProcessor.processFiles(...)` becomes `const { parsed: parsedResults, failures } = await astProcessor.processFiles(...)`. `mapAstToEvents(parsedResults)` (line 35) keeps working unchanged since it only ever consumed the parsed array. **New** (optional but recommended for consistency with G1's spirit, since `snapshot` has the identical 13-crash symptom per the audit): thread `failures.length` into the final `spinner.succeed(...)` message the same way `init.ts` does in Step 4 below. Flagged as an option, not a hard requirement of this plan, since the task is scoped to `init` — but the interface change touches this file regardless, so the marginal cost of also fixing its summary message is near zero and prevents `snapshot` from being left silently dishonest right after `init` is fixed. **Decision point for the user/execution agent**: do this now (recommended, ~5 extra lines, same pattern reused) or leave `snapshot`'s dishonest-success behavior for a separate follow-up ticket. Recommended: do it now.

**Verification (G6)**: new file `lib/core/src/services/ast-processing.service.unit.test.ts` (does not exist today):
- `it("returns all files under 'parsed' when every parse succeeds")` — trivial baseline, mocked `AstWorkerPool`.
- `it("moves a file to 'failures' with its error message when pool.parse resolves with success:false")` — mock `AstWorkerPool.parse` to resolve `{ success: false, error: "Unexpected token" }` for one file among five; assert `parsed.length === 4`, `failures` contains exactly `{ file, hash, error: "Unexpected token" }`.
- `it("moves a file to 'failures' when pool.parse rejects with AstWorkerCrashError")` — mock rejection; assert `failures[0].error` includes the crash message, `parsed` excludes that file.
- **`it("reproduces the audit's 13-crash/4236-file profile: batches of failures scattered across multiple 50-file batches all get attributed correctly")`** — this is the "real observed errors" test the user asked for: build a 200-file fixture list, mock the pool so a deterministic 13 specific files (scattered across at least 3 different batches, not clustered in one) reject with `AstWorkerCrashError`, assert `failures.length === 13`, `parsed.length === 187`, and every failed file's `file` field is present exactly once and matches one of the 13 designated failing paths (no misattribution, no duplication, no silent drop).

Since `AstWorkerPool` is constructed internally (`new AstWorkerPool()`, line 16) rather than injected, this test needs either (a) a constructor-injection seam added to `AstProcessingService` (recommended — mirrors the existing DI pattern used by `InitService`), or (b) `vi.mock("./ast-worker-pool.js")`. Recommend (a) for consistency with the rest of the codebase's constructor-injection style (seen in `InitService`) and because it makes the test faster/more deterministic than mocking a class with internal `Worker` lifecycle.

---

### Step 3 — Honest `InitService.init()` return contract

**File**: `lib/core/src/services/init-service.ts`

**Problem** (confirmed at line 127): `init()` unconditionally returns `{ success: true, message: "Project initialized successfully" }` regardless of `discovery.filesToParse.length` vs. how many files actually came back parsed.

**Decision point — return contract shape.** Three options, since this is genuinely ambiguous and affects both the CLI's exit code and how `success` is interpreted elsewhere in the codebase:

- **Option A — `success` stays a single boolean, becomes `false` on any parse failure.**
  ```ts
  return {
    success: failures.length === 0,
    message: failures.length === 0 ? INIT_SERVICE_MESSAGES.SUCCESS : `Initialized with ${failures.length}/${discovery.filesToParse.length} files failing to parse`,
    filesRequested: discovery.filesToParse.length,
    filesParsed: parsedResults.length,
    filesFailed: failures.length,
    failures,
  };
  ```
  Pro: simplest mental model, "success" means "fully succeeded." Con: `init()` also does git branch setup, hook install, DB creation, and hook/integration config — all of which can succeed even when parsing is partial. A single boolean conflates "the tool is usable" with "the index is complete," and `init.ts`'s current `catch` block treats any thrown error as `process.exit(1)` — but partial parse failure doesn't throw, it just needs different exit-code semantics than "the whole command failed." Also a breaking change for anything that currently branches on `result.success` expecting it to mean "did not throw."

- **Option B — keep `success: true` (meaning "init completed without throwing"), add a `partialFailure: boolean` flag plus counts.**
  ```ts
  return {
    success: true,
    partialFailure: failures.length > 0,
    message: failures.length === 0
      ? INIT_SERVICE_MESSAGES.SUCCESS
      : `Project initialized with ${failures.length} of ${discovery.filesToParse.length} files failing to parse — see .docuvia/logs/init.log`,
    filesRequested: discovery.filesToParse.length,
    filesParsed: parsedResults.length,
    filesFailed: failures.length,
    failures,
  };
  ```
  Pro: `success` keeps its current, narrower meaning (command completed, DB/branch/hooks are in a good state), so nothing that currently checks `result.success` breaks. `partialFailure` is additive and opt-in for callers that care. Con: two booleans that both look like health indicators can be confusing if not named/documented carefully; `init.ts` must be updated to actually branch on `partialFailure`, not just print `result.message` blindly (it currently does exactly that at line 20 — `spinner.succeed(result.message)` — so even Option B requires a CLI-side change, not just a data-side one).

- **Option C — drop the boolean's ambiguity entirely; replace `success` with an explicit status enum.**
  ```ts
  return {
    status: failures.length === 0 ? "success" : "partial",  // future: "failed" if DB/branch setup itself throws — it already does, via the existing try/catch at lines 52-80, this just gives that failure a name too
    message: /* as Option B */,
    filesRequested, filesParsed, filesFailed, failures,
  };
  ```
  Pro: most self-documenting; makes room for `"failed"` later without another breaking change. Con: largest surface change — every caller of `.success` (need to grep for `result.success` / `initService.init()` call sites beyond `init.ts` — confirmed via this document's investigation that `artifacts/cli/src/commands/init.ts:19-20` is the only current external caller) needs updating from boolean to string-enum comparison.

**Recommendation: Option B.** It's additive (doesn't redefine what `success` already means to any existing caller — confirmed only caller is `init.ts:19`), keeps the "did the command complete without throwing" signal intact for scripts/CI that might check exit code or `result.success`, and gives the CLI (`init.ts`) everything it needs to print an honest, non-green message when `partialFailure` is true. Flag this choice to the user/execution agent as a decision point rather than treating it as settled — Option C is the more architecturally "correct" long-term answer if `init` ever grows more failure modes worth distinguishing (e.g., DB init failure vs. parse failure vs. hook install failure), and would be a reasonable thing to revisit in a later pass once `review`/`sync` stop being stubs and more of the CLI needs consistent status reporting.

**Concrete change** (Option B), at line 82-127:

```ts
this.logCallback(`Parsing ${discovery.filesToParse.length} files...`);
const { parsed: parsedResults, failures } = await this.astProcessor.processFiles(
  this.workspaceRoot,
  discovery.filesToParse
);
for (const result of parsedResults) {
  const language = detectLanguageForFile(result.file);
  if (language) tags.add(language);
}

this.logCallback(`Persisting knowledge graph...`);
await this.graphRepository.persistAstGraph(this.workspaceRoot, parsedResults, Array.from(tags));

// ... existing TempFileManager block unchanged ...

const filesRequested = discovery.filesToParse.length;
const filesParsed = parsedResults.length;
const filesFailed = failures.length;

if (filesFailed > 0) {
  logger.warn({ filesRequested, filesParsed, filesFailed, failures }, "init completed with parse failures");
}

await writeInitLog(this.workspaceRoot, { filesRequested, filesParsed, filesFailed, failures }); // Step 4

return {
  success: true,
  partialFailure: filesFailed > 0,
  message: filesFailed === 0
    ? INIT_SERVICE_MESSAGES.SUCCESS
    : `Project initialized — ${filesFailed} of ${filesRequested} files failed to parse (see .docuvia/logs/init.log)`,
  filesRequested,
  filesParsed,
  filesFailed,
  failures,
};
```

Also switch the existing bare `message: "Project initialized successfully"` (currently a duplicate of `INIT_SERVICE_MESSAGES.SUCCESS`, which is already defined but unused) to actually reference the constant, and add a second constant for the partial-failure template to `init-service-messages.ts` rather than inlining a template string, consistent with the rest of that file's style:
```ts
// init-service-messages.ts — add:
PARTIAL_SUCCESS: (failed: number, requested: number) =>
  `Project initialized — ${failed} of ${requested} files failed to parse (see .docuvia/logs/init.log)`,
```

**Verification (G1, G6)**: extend `lib/core/src/services/init-service.unit.test.ts`:
- `it("reports success:true, partialFailure:false, filesFailed:0 when all files parse")` — extend the existing `parsedResults` fixture's shape to `{ parsed: parsedResults, failures: [] }` (the existing `astProcessor.processFiles` mock, lines 69-74, currently returns the bare array and must be updated to the new `{ parsed, failures }` shape — this is a required update to the *existing* baseline test, not just new tests, since it currently exercises exactly the old return contract).
- `it("reports partialFailure:true and a non-generic message when astProcessor.processFiles returns failures")` — mock `astProcessor.processFiles` to resolve `{ parsed: parsedResults.slice(0, 0), failures: [{ file: "src/broken.ts", hash: "h", error: "Worker exited with code 1" }] }`; assert `result.partialFailure === true`, `result.filesFailed === 1`, `result.message` does **not** equal `"Project initialized successfully"`, and `result.message` contains `"1"` and `"broken.ts"`'s failure is present in `result.failures`.
- `it("reproduces the audit scenario: 13 of 4236 files fail, init still completes and reports the exact counts")` — mock a 4236-length `filesToParse` fixture (or a representative smaller N to keep the test fast, e.g. 50, with 13 forced failures — the ratio matters more than the absolute count for this test's purpose) and assert `filesRequested`, `filesParsed`, `filesFailed` are internally consistent (`filesParsed + filesFailed === filesRequested`) and `result.success === true` (init itself didn't throw) while `result.partialFailure === true`.

---

### Step 4 — Persisted, AI-inspectable log (`G3`)

**New file**: `lib/core/src/services/init-log-writer.ts` (or a function co-located in `init-service.ts` if the execution agent judges a separate file is unwarranted for something this small — flag as an implementation-detail choice, not a hard requirement).

**Decision — plain `fs.writeFile`, not a second `pino` transport.** As established in the interpretation section, `pino`'s worker-thread transports are the literal cause of the Step 0 crash; adding a second pino transport target to solve observability would be ironic and risky. Use `pino.destination()` (safe, synchronous, no worker thread) *if* the execution agent wants every `logger.*` call during the run captured verbatim; otherwise (simpler, recommended) have `InitService` write one purpose-built structured summary object directly via `fs/promises`, independent of the logger's level filtering (so it's never accidentally silenced by `LOG_LEVEL=error` hiding the failure detail).

**Recommended path and format**: `<workspaceRoot>/.docuvia/logs/init.log`, newline-delimited JSON (JSONL — one event per line, appended, never truncated across runs, so an agent inspecting history sees every past `init` invocation, not just the latest). Each `init()` run appends:
1. One line at start: `{"ts": "...", "event": "init.start", "workspaceRoot": "..."}`
2. One line per failure, as it's discovered (not batched at the end — an agent tailing the file mid-run, or inspecting after a hard crash that skipped the final summary, still sees per-file detail): `{"ts": "...", "event": "init.parse_failure", "file": "...", "error": "..."}`
3. One final summary line: `{"ts": "...", "event": "init.summary", "filesRequested": N, "filesParsed": N, "filesFailed": N, "failures": [...]}`

```ts
// init-log-writer.ts
import fs from "fs/promises";
import path from "path";

export interface InitLogSummary {
  filesRequested: number;
  filesParsed: number;
  filesFailed: number;
  failures: { file: string; hash: string; error: string }[];
}

const INIT_LOG_RELATIVE_PATH = path.join(".docuvia", "logs", "init.log");

export async function appendInitLogLine(workspaceRoot: string, event: Record<string, unknown>): Promise<void> {
  const logPath = path.join(workspaceRoot, INIT_LOG_RELATIVE_PATH);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n", "utf8");
}

export async function writeInitSummary(workspaceRoot: string, summary: InitLogSummary): Promise<void> {
  await appendInitLogLine(workspaceRoot, { event: "init.summary", ...summary });
}
```

Call `appendInitLogLine(workspaceRoot, { event: "init.start", workspaceRoot })` near the top of `InitService.init()` (after line 40's `this.logCallback`), call `appendInitLogLine(workspaceRoot, { event: "init.parse_failure", ...failure })` for each entry in `failures` right after `processFiles` returns (or, better, have `AstProcessingService`/`AstWorkerPool` accept an optional `onFailure` callback so failures are logged as they're discovered rather than batched — flag this as a nice-to-have refinement, not required for G3, which only requires the file to exist with correct final content), and call `writeInitSummary(...)` right before `return` in Step 3's changed block.

Add `INIT_LOG_RELATIVE_PATH` (or the constant string `"logs"` as a new segment alongside `DOCUVIA_DIR_NAME`) to `lib/core/src/constants/paths.ts` rather than hardcoding `".docuvia/logs"` inline in the new file, consistent with that constants file's existing role.

**Verification (G3)**: new file `lib/core/src/services/init-log-writer.unit.test.ts`:
- `it("creates .docuvia/logs/init.log with a valid summary line when failures occur")` — call `writeInitSummary` directly with a fixture summary, read the file back with `fs.readFile`, `JSON.parse` the last line, assert its shape matches `InitLogSummary` plus `event`/`ts`.
- `it("appends rather than truncates across multiple invocations")` — call `appendInitLogLine` twice with different `workspaceRoot`-relative content, assert both lines are present and independently parseable (each line stands alone as valid JSON — classic JSONL contract).
- Extend the Step 3 `init-service.unit.test.ts` audit-scenario test to additionally assert (in a `tmpDir`-based integration-style check within that same test file, since `InitService`'s tests already use a real `tmpDir` via `fs.mkdtempSync`) that `.docuvia/logs/init.log` exists after `service.init()` runs and its last line's `filesFailed` matches the mocked failure count — this is the test that most directly proves G3 end-to-end (an agent could `Read` this exact file after a real run).

---

### Step 5 — CLI-side honest reporting (`G1`)

**File**: `artifacts/cli/src/commands/init.ts`

**Problem** (confirmed at line 19-20): `const result = await initService.init(); spinner.succeed(result.message);` — always calls `spinner.succeed` (green checkmark) regardless of content, and `result.message` was previously always the same success string.

**Change** (depends on Step 3's Option B contract):
```ts
const result = await initService.init();
if (result.partialFailure) {
  spinner.warn(result.message); // yellow/warn glyph instead of green check — most spinner libs (ora, etc.) expose .warn()
} else {
  spinner.succeed(result.message);
}
```
Confirm which spinner library `ui.spinner(...)` (from `artifacts/cli/src/ui/wizard.js`) wraps and that it exposes a `.warn()` method with equivalent semantics to `.succeed()`/`.fail()` (both already used, lines 20/23) before finalizing — if it doesn't, `ui.warn(result.message)` after a plain `spinner.stop()` is the fallback, matching the pattern already used in `configureAgentIntegrations` (line 52: `ui.info(...)`) and `initCommand` (line 75: `ui.warn(...)`) elsewhere in this same file.

Also add `UI_MESSAGES` entries as needed for any new fixed CLI-side strings (the audit's Priority Recommendation #3 explicitly asks for a visible failure count — that count comes from `result.filesFailed`/`result.message`, already carrying it per Step 3, so no new template string is strictly required here beyond what `InitService` already produces).

**Verification (G1)**: new file `artifacts/cli/test/unit/commands/init.unit.test.ts` (check first whether one already exists at that conventional path, per `artifacts/cli/test/unit/commands/snapshot.unit.test.ts`'s sibling location — if `init.unit.test.ts` doesn't exist yet, this is also new coverage of a previously-untested CLI command file):
- `it("calls spinner.succeed with the success message when partialFailure is false")`.
- `it("calls spinner.warn (not succeed) with a message containing the failure count when partialFailure is true")` — this is the test that most directly encodes G1's contract and should quote back the audit's own reproduction numbers in a comment (13 crashes / 4236 files) even though the unit test itself uses a small mocked count, so a future reader understands why this test exists.

---

### Step 6 (lower priority, same theme) — Gate `language-registry.ts`'s bare `console.debug`

**File**: `lib/ast-core/src/language-registry.ts:69-72`

**Problem**: `console.debug(...)` ignores `LOG_LEVEL` entirely and fires once per worker (13× in the audit's run, once per respawned/initial worker each loading the language registry independently).

**Change**: `lib/ast-core` doesn't currently depend on `@workspace/core`'s `logger` (check `lib/ast-core/package.json` dependencies before assuming this import is free — if `@workspace/core` isn't already a dependency of `@workspace/ast-core`, adding it purely for a debug log is disproportionate and risks a circular dependency, since `@workspace/core` depends on `@workspace/ast-core` for parsing, not the other way around). **Recommended**: do **not** import the shared `logger` here; instead accept an optional injected logging function or simply gate the existing `console.debug` behind a `process.env.LOG_LEVEL === "debug"` check, matching the intent without adding a cross-package dependency:
```ts
if (process.env.LOG_LEVEL === "debug") {
  console.debug(`[LanguageRegistry] Could not read ${targetPath}, falling back to defaults. Reason:`, ...);
}
```
This is explicitly **out of scope for `init`'s honesty/observability fix** (it's noise reduction, not data loss) — included here only because it's a one-line, low-risk, same-file-family cleanup the audit flagged adjacent to the crash noise. The execution agent should treat Steps 0-5 as required and Step 6 as optional/best-effort; do not let it block the rest of the plan.

**Verification**: extend or add `lib/ast-core/src/language-registry.unit.test.ts` (check if it exists first) with `it("does not call console.debug when LOG_LEVEL is not 'debug'")` using `vi.spyOn(console, "debug")`.

---

## 5. Implementation Details Summary (Files Touched)

| File | Package | Change |
|---|---|---|
| `lib/core/src/utils/logger.ts` | `@workspace/core` | Gate `pino-pretty` behind `DOCUVIA_PRETTY_LOGS=1` + fail-soft resolution (Step 0) |
| `lib/core/src/services/ast-worker-pool.ts` | `@workspace/core` | Add `taskFilePaths` map, export `AstWorkerCrashError`, route crash logs through `logger` (Step 1) |
| `lib/core/src/interfaces/analyzer.interfaces.ts` | `@workspace/core` | Add `AstParseFailure`, `AstProcessResult`; change `IAstProcessor.processFiles()` return type (Step 2) |
| `lib/core/src/services/ast-processing.service.ts` | `@workspace/core` | Collect `failures[]` instead of dropping them; route logs through `logger` (Step 2) |
| `lib/core/src/services/init-service.ts` | `@workspace/core` | Consume `{parsed, failures}`, compute honest return contract, write to init log (Step 3, 4) |
| `lib/core/src/constants/init-service-messages.ts` | `@workspace/core` | Add `PARTIAL_SUCCESS` template; wire `SUCCESS` into actual use (Step 3) |
| `lib/core/src/constants/paths.ts` | `@workspace/core` | Add log directory path segment constant (Step 4) |
| `lib/core/src/services/init-log-writer.ts` (new) | `@workspace/core` | JSONL append writer for `.docuvia/logs/init.log` (Step 4) |
| `artifacts/cli/src/commands/init.ts` | `@workspace/cli` | Branch `spinner.succeed` vs `spinner.warn` on `result.partialFailure` (Step 5) |
| `artifacts/cli/src/commands/snapshot.ts` | `@workspace/cli` | Update to new `{parsed, failures}` return shape (required, Step 2); optionally mirror honest-summary UX (recommended, Step 2 decision point) |
| `lib/ast-core/src/language-registry.ts` | `@workspace/ast-core` | Gate `console.debug` behind `LOG_LEVEL=debug` (Step 6, optional) |
| `lib/core/src/services/ast-worker-pool.unit.test.ts` | `@workspace/core` | New crash-attribution + respawn tests |
| `lib/core/src/services/ast-processing.service.unit.test.ts` (new) | `@workspace/core` | New file — failure-collection tests incl. 13/N audit-scenario test |
| `lib/core/src/services/init-service.unit.test.ts` | `@workspace/core` | Update existing mock to `{parsed, failures}` shape; add partial-failure + audit-scenario tests |
| `lib/core/src/services/init-log-writer.unit.test.ts` (new) | `@workspace/core` | New file — JSONL write/append tests |
| `lib/core/src/utils/logger.unit.test.ts` (new) | `@workspace/core` | New file — pino-pretty fail-soft tests |
| `artifacts/cli/test/unit/commands/init.unit.test.ts` (new, if absent) | `@workspace/cli` | New/extended file — spinner branch tests |
| `lib/ast-core/src/language-registry.unit.test.ts` | `@workspace/ast-core` | Extend with gating test (Step 6, optional) |

**Workspace packages affected**: `lib/core` (`@workspace/core`, primary — 4 source files + constants + 5 test files), `artifacts/cli` (`@workspace/cli` — 2 source files + 1 test file), `lib/ast-core` (`@workspace/ast-core` — 1 source file + 1 test file, optional/Step 6 only).

---

## 6. Architecture Diagram — Failure Data Flow (Before → After)

```
BEFORE (data dropped at every layer):

  AstWorkerPool.handleError()
    → console.error (stdout only, no file identity)
    → callbacks.reject(err)                              [file identity lost here]
        │
  AstProcessingService.processFiles() catch/else branch
    → console.log/console.warn (stdout only)
    → file silently excluded from parsedResults           [failure lost here]
        │
  InitService.init()
    → parsedResults (already missing failures) → persistAstGraph
    → return { success: true, message: "...successfully" } [count mismatch never checked]
        │
  init.ts
    → spinner.succeed(result.message)                     [green check regardless of reality]


AFTER:

  AstWorkerPool.handleError()
    → logger.error({taskId, filePath}, ...)
    → callbacks.reject(new AstWorkerCrashError(filePath, err))   [file identity preserved]
        │
  AstProcessingService.processFiles()
    → failures.push({file, hash, error})                          [failure captured]
    → return { parsed, failures }
        │
  InitService.init()
    → appendInitLogLine(...) per failure + writeInitSummary(...)   [persisted, AI-readable]
    → return { success: true, partialFailure: filesFailed > 0, filesRequested, filesParsed, filesFailed, failures, message }
        │
  init.ts
    → spinner.warn(result.message) when partialFailure              [honest, visible]
    → spinner.succeed(result.message) only when truly 0 failures
```

---

## 7. Open Decision Points for the Execution Agent (do not silently resolve — confirm or pick with stated reasoning)

1. **Return-contract shape** (Step 3): Option A / B / C above. This plan recommends **Option B**; if the execution agent has a strong reason to prefer A or C, it should say so before implementing, since it changes `init.ts`'s branching logic and the interface both implementers must satisfy.
2. **Test-seam for forcing a worker crash deterministically** (Step 1): constructor-injected fake worker script path vs. some other mechanism. Either is acceptable; pick whichever is less invasive to `AstWorkerPool`'s existing constructor signature.
3. **`snapshot.ts` mirroring the honest-summary fix** (Step 2): recommended to do now since the interface change touches this file regardless; not a hard requirement of this plan's scope (which is `init` only).
4. **Whether `init-log-writer.ts` should be its own file or inlined into `init-service.ts`**: no functional difference; own-file recommended for testability in isolation (Step 4's dedicated unit test file assumes this).
5. **Step 6 (`language-registry.ts` gating)**: optional, do last, do not let it block Steps 0-5.

---

## 8. Explicit Non-Goals (confirmed out of scope per the user's request)

- `docuvia analyze <path>`'s hardcoded stub (`extract-service.ts:20-21`) — separate audit finding, not part of this fix.
- `docuvia review`'s stub (`change-detection-service.ts:6-9`) — separate.
- `docuvia sync`'s stub (`sync-service.ts:11-15`) — separate.
- `export --topology`'s zero-link default / edge-count discrepancy — separate.
- `docuvia query`'s thin `query()` vs. richer `getContext()`/`getImpact()` — separate.
- `init`'s undocumented global side effects (Claude Desktop config, 8 tool integrations) — separate; this plan only touches the AST-scan honesty/observability path, not the integration-writing path (`configureAgentIntegrations` in `init.ts`, lines 28-66, untouched).
