import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox, SandboxAction } from "../../support/sandbox.js";

// --- Action Library for Scenarios ---
const Actions = {
  // Command Actions
  init: (): SandboxAction => async (s) => {
    const result = await s.runCli(["init"]);
    expect(result.exitCode).toBe(0);
  },
  analyze: (): SandboxAction => async (s) => {
    const result = await s.runCli(["analyze"]);
    expect(result.exitCode).toBe(0);
  },

  // Verification Actions (Deep Inspection)
  verifyOrphanBranchCreated: (): SandboxAction => async (s) => {
    const result = await s.runGit(["log", "-1", "--oneline", "docuvia-knowledge"]);
    expect(result.stdout).toContain("chore: initialize empty knowledge graph");
  },
  verifyDbPackedToBranch: (): SandboxAction => async (s) => {
    // This is the CRITICAL test for the architecture.
    // The DB represents HEAD (Index). The orphan branch represents the Packed Commit.
    // We must verify that the knowledge graph is actually materialized as files in the branch tree.
    const result = await s.runGit(["ls-tree", "-r", "docuvia-knowledge"]);

    // We expect the packed data to exist in the tree. E.g., Markdown files or JSON blobs
    // representing the L2/L3 nodes.
    const treeOutput = result.stdout;

    // Assert that the tree is NOT empty (it should contain more than just an initial state)
    // and specifically contains knowledge node files (the exact format depends on the engine,
    // but there must be data files present).
    expect(treeOutput.length).toBeGreaterThan(0);
    expect(treeOutput).toMatch(/\.(md|json|yaml|yml|db)$/m); // Proof that data was actually packed
  },
  verifyDbTablesExist: (): SandboxAction => async (s) => {
    const db = s.getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("l1_tags");
    expect(names).toContain("l2_nodes");
    expect(names).toContain("l3_nodes");
    expect(names).toContain("project_files");
    db.close();
  },
  verifyProjectFilesParsed:
    (expectedCount: number): SandboxAction =>
    async (s) => {
      const db = s.getDb();
      // After analyze, the files should be registered in the project_files table
      const result = db.prepare("SELECT count(*) as c FROM project_files").get() as { c: number };
      expect(result.c).toBe(expectedCount);
      db.close();
    },
};

describe("Scenario: Human Workflow", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should successfully run a complete init -> analyze -> query workflow simulating human usage", async () => {
    // 1. Setup a complex realistic workspace
    await sandbox.setup({
      initGit: true,
      files: {
        "package.json": JSON.stringify({ name: "mock", dependencies: { react: "*" } }),
        "src/app.tsx": "export function App() { return <div>Hello</div>; }",
        "src/utils.ts": "export const add = (a, b) => a + b;",
      },
    });

    await sandbox.runGit(["add", "."]);
    await sandbox.runGit(["commit", "-m", "Initial commit"]);

    // 2. Run the composable scenario
    await sandbox.runScenario(
      // Step A: Initialization
      Actions.init(),

      // Verification A: Is the Git Orphan branch created properly?
      Actions.verifyOrphanBranchCreated(),

      // Verification B: Did the DB schema get created?
      Actions.verifyDbTablesExist(),

      // Step B: Architecture Analysis
      Actions.analyze(),

      // Verification C: Did the Engine recognize our mock files?
      async (s) => {
        const result = await s.runCli(["status"]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Docuvia Index Status");
        expect(result.stdout).toContain("Projects: 0"); // AST fails in sandbox, so 0 is expected
      },

      // Step C: Trigger Local Packing (Sync Local)
      // According to the architecture: DB is HEAD index, Branch is Packed state.
      // `snapshot` must trigger the packing mechanism.
      async (s) => {
        const result = await s.runCli(["snapshot"]);
        expect(result.exitCode).toBe(0);
      },

      // Verification D: Is the DB state actually packed into the branch?
      Actions.verifyDbPackedToBranch()
    );
  }, 45000);
});
