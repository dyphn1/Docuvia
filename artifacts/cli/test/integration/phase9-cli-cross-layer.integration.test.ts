import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REAL_SUBPROCESS_TEST_TIMEOUT_MS } from "../support/integration-env.js";
import { TestSandbox, buildDistCli } from "../support/sandbox.js";

interface PersistedGraphCounts {
  projects: number;
  l2Nodes: number;
}

function readPersistedGraphCounts(sandbox: TestSandbox): PersistedGraphCounts {
  const db = sandbox.getDb();
  try {
    const projects = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
      count: number;
    };
    const l2Nodes = db.prepare("SELECT COUNT(*) AS count FROM l2_nodes").get() as {
      count: number;
    };
    return { projects: projects.count, l2Nodes: l2Nodes.count };
  } finally {
    db.close();
  }
}

function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

/**
 * Phase 9 owns the presentation/cross-layer boundary rather than the lower-layer algorithms that
 * Phases 1-8 already hardened. These tests therefore execute the real CLI entrypoint and, where
 * packaging itself is the contract, the freshly-built `dist/cli.js` under plain Node.
 *
 * TDD-SOURCE: docs/gitbook/user-guide/cli.md#cli-commands
 * TDD-SOURCE: artifacts/cli/src/cli.ts#main
 * TDD-SOURCE: docs/gitbook/user-guide/cli/init.md#init
 * TDD-SOURCE: artifacts/cli/src/commands/init.ts#initCommand
 * TDD-SOURCE: docs/gitbook/user-guide/cli/analyze.md#analyze
 * TDD-SOURCE: artifacts/cli/src/commands/analyze.ts#analyzeCommand
 * TDD-SOURCE: docs/gitbook/user-guide/cli/query.md#query
 * TDD-SOURCE: artifacts/cli/src/commands/query.ts#queryCommand
 * TDD-SOURCE: docs/gitbook/user-guide/cli/impact.md#impact
 * TDD-SOURCE: artifacts/cli/src/commands/impact.ts#impactCommand
 * TDD-SOURCE: artifacts/cli/package.json#bin
 * TDD-SOURCE: artifacts/cli/test/support/sandbox.ts#runDistCli
 */
describe("Phase 9 CLI and cross-layer workflow quality", () => {
  beforeAll(async () => {
    await buildDistCli();
  }, REAL_SUBPROCESS_TEST_TIMEOUT_MS);

  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "src/handlers.ts": [
          "export function run(): number {",
          "  return helper();",
          "}",
          "",
          "function helper(): number {",
          "  return 42;",
          "}",
        ].join("\n"),
      },
    });
  }, REAL_SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await sandbox.teardown();
  }, REAL_SUBPROCESS_TEST_TIMEOUT_MS);

  it(
    "returns byte-stable global help/version output across repeated identical invocations",
    async () => {
      const helpFirst = await sandbox.runCli(["--help"]);
      const helpSecond = await sandbox.runCli(["--help"]);
      const versionFirst = await sandbox.runCli(["--version"]);
      const versionSecond = await sandbox.runCli(["--version"]);

      expect(helpFirst.exitCode).toBe(0);
      expect(helpSecond.exitCode).toBe(0);
      expect(helpFirst.stdout).toBe(helpSecond.stdout);
      expect(helpFirst.stdout).toContain("Usage:");

      expect(versionFirst.exitCode).toBe(0);
      expect(versionSecond.exitCode).toBe(0);
      expect(versionFirst.stdout).toBe(versionSecond.stdout);
      expect(versionFirst.stdout.trim()).not.toBe("");
    },
    REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "rejects an unknown command option before command execution",
    async () => {
      const result = await sandbox.runCli(["status", "--definitely-unknown"], {
        reject: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown options provided");
      expect(result.stdout).not.toContain("Docuvia Status");
    },
    REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "keeps repeated init idempotent at the persisted graph boundary",
    async () => {
      const first = await sandbox.runCli(["init"]);
      expect(first.exitCode).toBe(0);
      const firstCounts = readPersistedGraphCounts(sandbox);
      expect(firstCounts.projects).toBe(1);
      expect(firstCounts.l2Nodes).toBeGreaterThanOrEqual(2);

      const second = await sandbox.runCli(["init"]);
      expect(second.exitCode).toBe(0);
      const secondCounts = readPersistedGraphCounts(sandbox);

      expect(secondCounts).toEqual(firstCounts);
    },
    REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "returns byte-stable structured query/impact results across repeated identical invocations",
    async () => {
      const init = await sandbox.runCli(["init"]);
      expect(init.exitCode).toBe(0);

      const queryFirst = await sandbox.runCli([
        "query",
        "run",
        "--format=json",
      ]);
      const querySecond = await sandbox.runCli([
        "query",
        "run",
        "--format=json",
      ]);
      expect(queryFirst.exitCode).toBe(0);
      expect(querySecond.exitCode).toBe(0);
      expect(queryFirst.stdout).toBe(querySecond.stdout);
      const query = parseJsonOutput<{ l2: { name?: string } | null }>(
        queryFirst.stdout,
      );
      expect(query.l2?.name).toBe("run");

      const impactFirst = await sandbox.runCli([
        "impact",
        "run",
        "--format=json",
      ]);
      const impactSecond = await sandbox.runCli([
        "impact",
        "run",
        "--format=json",
      ]);
      expect(impactFirst.exitCode).toBe(0);
      expect(impactSecond.exitCode).toBe(0);
      expect(impactFirst.stdout).toBe(impactSecond.stdout);
      const impact = parseJsonOutput<{ riskLevel?: string } | null>(
        impactFirst.stdout,
      );
      expect(impact).not.toBeNull();
      expect(impact?.riskLevel).toEqual(expect.any(String));
    },
    REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "keeps the freshly built dist CLI deterministic and fail-closed across smoke/workflow reruns",
    async () => {
      const helpFirst = await sandbox.runDistCli(["--help"]);
      const helpSecond = await sandbox.runDistCli(["--help"]);
      expect(helpFirst.exitCode).toBe(0);
      expect(helpSecond.exitCode).toBe(0);
      expect(helpFirst.stdout).toBe(helpSecond.stdout);

      const malformed = await sandbox.runDistCli(
        ["status", "--definitely-unknown"],
        { reject: false },
      );
      expect(malformed.exitCode).toBe(1);
      expect(malformed.stderr).toContain("Unknown options provided");
      expect(malformed.stdout).not.toContain("Docuvia Status");

      const init = await sandbox.runDistCli(["init"]);
      expect(init.exitCode).toBe(0);

      const queryFirst = await sandbox.runDistCli([
        "query",
        "run",
        "--format=json",
      ]);
      const querySecond = await sandbox.runDistCli([
        "query",
        "run",
        "--format=json",
      ]);
      expect(queryFirst.exitCode).toBe(0);
      expect(querySecond.exitCode).toBe(0);
      expect(queryFirst.stdout).toBe(querySecond.stdout);
      expect(
        parseJsonOutput<{ l2: { name?: string } | null }>(queryFirst.stdout).l2
          ?.name,
      ).toBe("run");
    },
    REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
