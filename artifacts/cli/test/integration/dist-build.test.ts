import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { TestSandbox, buildDistCli } from "../support/sandbox.js";

/**
 * Regression suite for a class of bug that every *other* integration test in this project is
 * structurally blind to: every other test drives the CLI via `tsx` from TypeScript source
 * (`TestSandbox.runCli()`), whose loader silently works around problems that only exist in the
 * bundled `dist/cli.js` that real users (and `bin: { docuvia: "./dist/cli.js" }`) actually run.
 *
 * Concretely, this once let three packaging bugs ship invisibly:
 *  - `tsup`'s injected shebang banner duplicated the one already in `src/cli.ts`, so
 *    `node dist/cli.js` failed with a `SyntaxError` before executing a single line.
 *  - The AST worker pool's `path.resolve(__dirname, "./ast-worker.js")` lookup, the
 *    `web-tree-sitter` runtime wasm, the `tree-sitter-wasms` grammar files, and
 *    `lib/schema`'s SQL migrations are all resolved relative to wherever the running file's
 *    `__dirname` happens to be — an assumption bundling breaks, since it moves code away from its
 *    source layout. `tsx` (running straight from source) never disturbs any of these paths, so
 *    none of the `tsx`-based tests could ever have caught it.
 *
 * Every test below runs against a freshly-built `dist/cli.js` via plain `node`
 * (`TestSandbox.runDistCli()`) so a regression in any of the above fails here, not in a user's
 * terminal.
 */
describe("dist/cli.js (compiled build, run via plain `node` — not tsx)", () => {
  beforeAll(async () => {
    await buildDistCli();
  }, 60000);

  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        // Two bare, truly-unbound function expressions in the same file: resolveCallableName()
        // gives both the literal name "anonymous", so this also doubles as an in-situ regression
        // check for the node_key collision fix (persist-ast-graph.ts's uniqueNodeKey()) — the
        // very same symptom that surfaced here first, as a real `init` crash, before it was
        // isolated into a unit test.
        "src/handlers.ts": [
          "export function run(): void {",
          '  [1, 2, 3].forEach(function () { console.log("a"); });',
          '  [4, 5, 6].forEach(function () { console.log("b"); });',
          "}",
        ].join("\n"),
      },
    });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("boots and runs a basic command without crashing (regression: duplicated shebang / bundling made node dist/cli.js unrunnable)", async () => {
    const result = await sandbox.runDistCli(["status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Docuvia Status");
  }, 25000);

  it("init populates a real, non-empty knowledge graph via the compiled build (regression: AST worker crash-loop / missing wasm+migrations+grammar assets under bundling)", async () => {
    const initResult = await sandbox.runDistCli(["init"]);
    expect(initResult.exitCode).toBe(0);

    const db = sandbox.getDb();
    try {
      const { count: l2NodeCount } = db
        .prepare("SELECT COUNT(*) as count FROM l2_nodes")
        .get() as { count: number };
      // 1 file node + 2 "anonymous" function nodes at minimum. If AST parsing silently failed
      // (worker crash swallowed as a per-file failure, or a missing wasm/grammar asset made it
      // fall back to regex-only extraction that finds no functions), this would be 0 or 1.
      expect(l2NodeCount).toBeGreaterThanOrEqual(3);

      // Both "anonymous" callbacks must have landed under distinct node_keys — this is the
      // dist-build-level counterpart to persist-ast-graph.unit.test.ts's collision regression
      // test: the UNIQUE(project_id, node_key) constraint used to throw here and crash `init`.
      const anonymousRows = db
        .prepare("SELECT node_key FROM l2_nodes WHERE name = 'anonymous'")
        .all() as { node_key: string }[];
      expect(anonymousRows).toHaveLength(2);
      expect(new Set(anonymousRows.map((r) => r.node_key)).size).toBe(2);
    } finally {
      db.close();
    }
  }, 30000);

  it("regression: running status immediately after init does not wipe the graph init just built (ensureHydrated() used to force a destructive re-hydrate from the still-empty knowledge branch)", async () => {
    await sandbox.runDistCli(["init"]);

    const nodeCountBeforeStatus = (
      sandbox
        .getDb()
        .prepare("SELECT COUNT(*) as count FROM l2_nodes")
        .get() as {
        count: number;
      }
    ).count;
    expect(nodeCountBeforeStatus).toBeGreaterThan(0);

    const statusResult = await sandbox.runDistCli(["status"]);
    expect(statusResult.exitCode).toBe(0);

    const nodeCountAfterStatus = (
      sandbox
        .getDb()
        .prepare("SELECT COUNT(*) as count FROM l2_nodes")
        .get() as {
        count: number;
      }
    ).count;
    expect(nodeCountAfterStatus).toBe(nodeCountBeforeStatus);
    expect(statusResult.stdout).toContain(`L2 Nodes: ${nodeCountBeforeStatus}`);
  }, 30000);

  it("query and impact return real results against the compiled build's graph, not just an empty-graph no-op", async () => {
    await sandbox.runDistCli(["init"]);

    const queryResult = await sandbox.runDistCli(["query", "run"]);
    expect(queryResult.exitCode).toBe(0);
    expect(queryResult.stdout).not.toContain("No matching module found");

    const impactResult = await sandbox.runDistCli(["impact", "run"]);
    expect(impactResult.exitCode).toBe(0);
    expect(impactResult.stdout).not.toContain("No matching node found");
  }, 30000);
});
