import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execa } from "execa";
import { CLI_ERROR_MESSAGES } from "../../../src/constants/cli-errors.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { TestSandbox } from "../../support/sandbox.js";

async function commitFile(
  sandbox: TestSandbox,
  file: string,
  content: string,
): Promise<void> {
  await writeFile(resolve(sandbox.dir, file), content, "utf-8");
  await execa("git", ["add", "--", file], { cwd: sandbox.dir });
  await execa("git", ["commit", "-q", "--no-verify", "-m", file], {
    cwd: sandbox.dir,
  });
}

/** The shared sandbox runner spawns the platform tsx shim; a raw `node --import <path>` fails on
 *  Windows, where an absolute loader path must be a file:// URL. */
function runSourceCli(sandbox: TestSandbox, args: string[]) {
  return sandbox.runCli(args, { reject: false });
}

describe("Command: docuvia review --head input validation", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true });
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await sandbox.teardown();
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  it(
    "[invalid-input] rejects a valueless --head flag before running review",
    async () => {
      const result = await runSourceCli(sandbox, [
        "review",
        "origin/main",
        "--head",
        "--format=json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(CLI_ERROR_MESSAGES.HEAD_REQUIRES_VALUE);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[invalid-input] rejects an empty --head= value before running review",
    async () => {
      const result = await runSourceCli(sandbox, [
        "review",
        "origin/main",
        "--head=",
        "--format=json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(CLI_ERROR_MESSAGES.HEAD_REQUIRES_VALUE);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[happy] reviews exactly the committed merge-base..HEAD range",
    async () => {
      await commitFile(sandbox, "base.ts", "export const base = 1;\n");
      await commitFile(sandbox, "feature.ts", "export const feature = 2;\n");
      const init = await runSourceCli(sandbox, ["init", "--platform="]);
      expect(init.exitCode).toBe(0);
      // An uncommitted edit must not leak into committed-range mode.
      await writeFile(
        resolve(sandbox.dir, "base.ts"),
        "export const base = 3;\n",
      );

      const result = await runSourceCli(sandbox, [
        "review",
        "HEAD~1",
        "--head",
        "HEAD",
        "--format=json",
      ]);

      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout) as {
        filesChanged: { file: string }[];
      };
      expect(report.filesChanged.map((f) => f.file)).toEqual(["feature.ts"]);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[error-handling] rejects a --head ref that is not the checked-out HEAD",
    async () => {
      await commitFile(sandbox, "base.ts", "export const base = 1;\n");
      await commitFile(sandbox, "feature.ts", "export const feature = 2;\n");

      const result = await runSourceCli(sandbox, [
        "review",
        "HEAD~1",
        "--head",
        "HEAD~1",
        "--format=json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "--head ref must resolve to the checked-out HEAD",
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
