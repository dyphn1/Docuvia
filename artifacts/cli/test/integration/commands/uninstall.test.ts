import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";
import { resolve } from "path";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { GitConstants } from "@workspace/core";

describe("Command: docuvia uninstall", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "src/index.ts":
          "export function hello(): string {\n  return 'world';\n}\n",
      },
    });

    // Create an init state first
    await sandbox.runCli(["init"]);

    // Simulate generic markdown file modifications that uninstall should clean up
    const dummyMarkdown =
      "<!-- docuvia:start -->\nSome content\n<!-- docuvia:end -->\nOther user content";
    writeFileSync(resolve(sandbox.dir, "CLAUDE.md"), dummyMarkdown);
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("should securely reverse integrations, create .bak files, and wipe the database", async () => {
    const result = await sandbox.runCli(["uninstall"]);

    // Success
    expect(result.exitCode).toBe(0);

    // Database must be wiped
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath), "Local database file should be deleted").toBe(
      false,
    );

    // .bak file should be created for CLAUDE.md
    expect(existsSync(resolve(sandbox.dir, "CLAUDE.md.bak"))).toBe(true);

    // CLAUDE.md should not contain the markers
    const claudeMd = require("fs").readFileSync(
      resolve(sandbox.dir, "CLAUDE.md"),
      "utf8",
    );
    expect(claudeMd).not.toContain("<!-- docuvia:start -->");
    expect(claudeMd).toContain("Other user content");
  }, 25000);

  /**
   * Real end-to-end (real `IGitProvider`/`GitLocalProvider`, real filesystem -- no mocks) coverage
   * for the plan's §3 "Gating tests" requirement for T1 (phase1-decision-integration.md §10a,
   * `implement_slice5-doctor-reliability.md` §3): `uninstall` after a real `init` leaves zero
   * Docuvia content in both the post-commit and pre-push hook files it installed.
   */
  it("leaves zero Docuvia-authored content in both the post-commit and pre-push hook files real init installed", async () => {
    const postCommitPath = resolve(
      sandbox.dir,
      ".git",
      "hooks",
      GitConstants.POST_COMMIT_HOOK_NAME,
    );
    const prePushPath = resolve(
      sandbox.dir,
      ".git",
      "hooks",
      GitConstants.PRE_PUSH_HOOK_NAME,
    );

    // `init` (already run in beforeEach) really did install both hooks with Docuvia content --
    // sanity-check the precondition before asserting uninstall removed it.
    expect(readFileSync(postCommitPath, "utf8")).toContain(
      GitConstants.POST_COMMIT_HOOK_MARKER,
    );
    expect(readFileSync(prePushPath, "utf8")).toContain(
      GitConstants.PRE_PUSH_HOOK_MARKER,
    );

    const result = await sandbox.runCli(["uninstall"]);
    expect(result.exitCode).toBe(0);

    const postCommitContent = readFileSync(postCommitPath, "utf8");
    expect(postCommitContent).not.toContain(
      GitConstants.POST_COMMIT_HOOK_MARKER,
    );
    expect(postCommitContent).not.toContain(
      GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER,
    );

    const prePushContent = readFileSync(prePushPath, "utf8");
    expect(prePushContent).not.toContain(GitConstants.PRE_PUSH_HOOK_MARKER);
  }, 25000);
});
