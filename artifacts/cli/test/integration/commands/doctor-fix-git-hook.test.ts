import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from "fs";
import { GitConstants } from "@workspace/contracts";
import { TestSandbox } from "../../support/sandbox.js";

/**
 * Real end-to-end (real `IGitProvider`/`GitLocalProvider`, real filesystem, real CLI subprocess --
 * no mocks) coverage for the plan's §3 "Gating tests" requirement for T5/T6
 * (phase1-decision-integration.md §10d, `implement_slice5-doctor-reliability.md` §3): a
 * hand-constructed duplicate-block `.git/hooks/post-commit` -> `docuvia doctor` reports it ->
 * `docuvia doctor --fix` repairs it -> `docuvia doctor` re-run reports the duplicate condition
 * gone. Mirrors `doctor-hydrate-concurrency.test.ts`'s real-CLI-process pattern.
 */
describe("Command: docuvia doctor --fix repairs a duplicate-block post-commit hook (real filesystem)", () => {
  let sandbox: TestSandbox;
  let hookPath: string;

  /** `probeDocuviaResolvable`'s local-binary short-circuit (`node_modules/.bin/docuvia`) so the
   *  `git_hook` diagnostic's resolvability check doesn't depend on a live, potentially-flaky
   *  `npx --no-install docuvia` network probe in CI -- deterministic and fast. */
  function stubLocalDocuviaBinary(): void {
    const binDir = resolve(sandbox.dir, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const name = process.platform === "win32" ? "docuvia.cmd" : "docuvia";
    const content =
      process.platform === "win32"
        ? "@echo off\r\nexit /b 0\r\n"
        : "#!/bin/sh\nexit 0\n";
    const fullPath = resolve(binDir, name);
    writeFileSync(fullPath, content);
    if (process.platform !== "win32") chmodSync(fullPath, 0o755);
  }

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "src/index.ts":
          "export function hello(): string {\n  return 'world';\n}\n",
      },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    // `init` creates the knowledge branch (repairDuplicatePostCommitHook's lock target) and a
    // real `.git/hooks/post-commit`, which this test then hand-corrupts into the duplicate-block
    // shape (simulating the §9n hand-edited-legacy-block bug).
    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    stubLocalDocuviaBinary();

    hookPath = resolve(
      sandbox.dir,
      ".git",
      "hooks",
      GitConstants.POST_COMMIT_HOOK_NAME,
    );
    writeFileSync(
      hookPath,
      `echo "before"\n` +
        GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT +
        GitConstants.POST_COMMIT_HOOK_CONTENT +
        `echo "after"\n`,
    );
  }, 60000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("reports FAIL for the duplicate-block condition, leaves the hook untouched without --fix, repairs it with --fix, and reports clean on re-run", async () => {
    // 1. `doctor` (no --fix) reports the duplicate-block FAIL and does not mutate the file.
    const beforeContent = readFileSync(hookPath, "utf8");
    const doctorBefore = await sandbox.runCli(["doctor"], { reject: false });
    const doctorBeforeOutput = doctorBefore.stdout + doctorBefore.stderr;
    // Sectioned-table report (IFCE CLI output-style pass): a "Git Hooks" section header, and a
    // table row carrying the git_hook check's id + message + suggested fix.
    expect(doctorBeforeOutput).toContain("Git Hooks");
    expect(doctorBeforeOutput).toContain("git_hook");
    expect(doctorBeforeOutput).toContain("Duplicate hook blocks detected");
    expect(doctorBeforeOutput).toContain("doctor --fix");
    expect(readFileSync(hookPath, "utf8")).toBe(beforeContent);

    // 2. `doctor --fix` repairs it: exactly one canonical block, zero legacy markers, zero
    // orphaned shebang lines, and unrelated user content preserved.
    const doctorFix = await sandbox.runCli(["doctor", "--fix"], {
      reject: false,
    });
    expect(doctorFix.stdout + doctorFix.stderr).toContain("git_hook");

    const repairedContent = readFileSync(hookPath, "utf8");
    expect(repairedContent).not.toContain(
      GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER,
    );
    // Exactly one canonical block present -- POST_COMMIT_HOOK_MARKER ("docuvia analyze") occurs
    // twice within that one block since issue #42 (once on its own line, once as a substring of
    // the "docuvia analyze --flush-staged-l3" line), so 2 total occurrences (not 1) confirms a
    // single, non-duplicated block, not two.
    expect(
      repairedContent.split(GitConstants.POST_COMMIT_HOOK_MARKER).length - 1,
    ).toBe(2);
    expect((repairedContent.match(/^#!.*$/gm) ?? []).length).toBe(1);
    expect(repairedContent).toContain('echo "before"');
    expect(repairedContent).toContain('echo "after"');

    // 3. `doctor` re-run no longer reports the duplicate-block condition (the specific defect
    // this test targets is resolved -- independent of the separate, environment-dependent
    // resolvability sub-check this same diagnostic key may also report on).
    const doctorAfter = await sandbox.runCli(["doctor"], { reject: false });
    const doctorAfterOutput = doctorAfter.stdout + doctorAfter.stderr;
    expect(doctorAfterOutput).not.toContain("Duplicate hook blocks detected");
    expect(doctorAfterOutput).not.toContain("legacy `docuvia snapshot`");
  }, 90000);
});
