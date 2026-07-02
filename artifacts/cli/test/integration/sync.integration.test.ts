import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../support/sandbox.js";

describe("CLI Regression Tests - Sync --local", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should parse workspace and pack generated files to docuvia-knowledge branch", async () => {
    await sandbox.setup({
      initGit: true,
      files: {
        "src/utils.ts": `
          export function utils() { return "utils"; }
        `,
        "src/hello.ts": `
          import { utils } from "./utils.js";
          export class HelloService {
            sayHello() { return utils(); }
          }
        `,
      },
    });

    await sandbox.runGit(["add", "."]);
    await sandbox.runGit(["commit", "-m", "Initial commit"]);

    const result = await sandbox.runCli(["sync", "--local"], { reject: false });
    console.log("STDOUT", result.stdout);
    console.log("STDERR", result.stderr);
    expect(result.exitCode).toBe(0);

    const lsTree = await sandbox.runGit(["ls-tree", "-r", "docuvia-knowledge"]);
    const files = lsTree.stdout;

    // Check JSONL files
    expect(files).toContain("graph/nodes.jsonl");
    expect(files).toContain("graph/edges.jsonl");

    // Check Markdown files for file
    // Due to WASM loading paths in test env, it might fallback to no-AST, but File events are always emitted
    expect(files).toContain("knowledge/src/hello.ts.md");
    expect(files).toContain("knowledge/src/utils.ts.md");
  }, 30000);

  it("should sync indexed files only and ignore unstaged/untracked files", async () => {
    await sandbox.setup({
      initGit: true,
      files: {
        "src/utils.ts": `
          export function utils() { return "utils"; }
        `,
      },
    });

    await sandbox.runGit(["add", "."]);
    await sandbox.runGit(["commit", "-m", "Initial commit"]);

    const { writeFile } = await import("fs/promises");
    const { join } = await import("path");

    // Modify existing file without staging
    await writeFile(
      join(sandbox.dir, "src/utils.ts"),
      `
        export function utils() { return "dirty-utils"; }
        export function dirtyFunction() { return "should not be parsed"; }
      `,
      "utf-8"
    );

    // Create untracked file
    await writeFile(
      join(sandbox.dir, "src/untracked.ts"),
      `export function untracked() { return "untracked"; }`,
      "utf-8"
    );

    const result = await sandbox.runCli(["sync", "--local"], { reject: false });
    expect(result.exitCode).toBe(0);

    const lsTree = await sandbox.runGit(["ls-tree", "-r", "docuvia-knowledge"]);
    const files = lsTree.stdout;

    // Check that untracked file is NOT in the tree
    expect(files).not.toContain("knowledge/src/untracked.ts.md");
    expect(files).toContain("knowledge/src/utils.ts.md");

    // Extract the graph data from git blob to check if 'dirtyFunction' is present
    const nodesJsonlResult = await sandbox.runGit(["show", "docuvia-knowledge:graph/nodes.jsonl"]);
    const nodesContent = nodesJsonlResult.stdout;

    expect(nodesContent).toContain("utils");
    expect(nodesContent).not.toContain("dirtyFunction");
  }, 30000);
});
