import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";
import Database from "better-sqlite3";
import { resolve } from "path";

/**
 * The other `init` integration tests only ever seed a single TypeScript file, so a parser
 * crash/regression confined to any other supported language (Python, Go, Java, ...) would never
 * surface here. This suite seeds one fixture per language and asserts the AST layer actually
 * extracted a named symbol from each — not just that `init` exited 0, which a silently-skipped
 * unparseable file would also do.
 */
describe("Command: docuvia init — multi-language AST parsing", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "src/index.ts":
          "export function greetTs(): string {\n  return 'ts';\n}\n",
        "src/main.py": "def greet_py():\n    return 'py'\n",
        "src/main.go":
          'package main\n\nfunc GreetGo() string {\n\treturn "go"\n}\n',
        "src/Main.java":
          'public class Main {\n  public static String greetJava() {\n    return "java";\n  }\n}\n',
      },
    });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("parses every seeded language into project_files and produces a named l2_node for each", async () => {
    const result = await sandbox.runCli(["init"]);
    expect(result.exitCode).toBe(0);

    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const db = new Database(dbPath, { readonly: true });
    try {
      const filePaths = (
        db.prepare("SELECT file_path FROM project_files").all() as {
          file_path: string;
        }[]
      ).map((r) => r.file_path.replace(/\\/g, "/"));

      for (const expected of [
        "src/index.ts",
        "src/main.py",
        "src/main.go",
        "src/Main.java",
      ]) {
        expect(
          filePaths.some((p) => p.endsWith(expected)),
          `expected project_files to contain ${expected}, got: ${JSON.stringify(filePaths)}`,
        ).toBe(true);
      }

      const nodeNames = (
        db.prepare("SELECT name FROM l2_nodes").all() as { name: string }[]
      ).map((r) => r.name);

      // Each language-specific function/class name must show up as a real parsed symbol. If a
      // parser silently failed (missing wasm/grammar asset, worker crash swallowed as a per-file
      // failure), the file would still be recorded in project_files but no symbol would appear
      // here for that language.
      for (const expectedSymbol of [
        "greetTs",
        "greet_py",
        "GreetGo",
        "greetJava",
      ]) {
        expect(
          nodeNames,
          `expected l2_nodes to contain a node named "${expectedSymbol}", got: ${JSON.stringify(nodeNames)}`,
        ).toContain(expectedSymbol);
      }
    } finally {
      db.close();
    }
  }, 30000);
});
