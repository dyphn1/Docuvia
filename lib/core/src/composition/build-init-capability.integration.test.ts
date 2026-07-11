import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import DatabaseCtor from "better-sqlite3";
import { buildInitCapability } from "./build-init-capability.js";

/**
 * End-to-end test of `InitCommand.execute()` through the real composition root
 * (`buildInitCapability`) — no mocks anywhere in this file. Exercises a real temp git repo
 * (`WorkspaceGitService`'s actual `git` shell-outs), a real temp SQLite file (`GraphStore`),
 * real `FileDiscoveryService`/`ConfigScannerService`/`VcsScannerService`, and a real
 * `AstProcessingService` + `AstWorkerPool` (actual worker-thread tree-sitter parsing).
 * This is the test that actually proves the god-method decomposition preserves behavior —
 * unit tests with mocked collaborators can't catch a wiring mistake in
 * `buildInitCapability` itself.
 *
 * Mirrors what old Docuvia's `init.test.ts` (CLI integration test) checked: `.docuvia/local.db`
 * has the expected tables/rows after a run, and a second run is idempotent (no duplicate
 * `projects` row).
 */
describe("buildInitCapability + InitCommand.execute() (end-to-end)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-init-e2e-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@docuvia.dev"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.name", "Docuvia Test"], { cwd: tmpDir });

    fs.writeFileSync(
      path.join(tmpDir, "index.ts"),
      "import { helper } from './helper';\nexport function main() { return helper(); }\n"
    );
    fs.writeFileSync(
      path.join(tmpDir, "helper.ts"),
      "export function helper() { return 42; }\n"
    );
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "e2e-fixture", version: "0.0.0", dependencies: { typescript: "^5" } })
    );

    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "initial commit"], { cwd: tmpDir });
  }, 30_000);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs init end-to-end: creates local.db with the expected tables/rows, the knowledge branch, and logs", async () => {
    const command = await buildInitCapability({ workspaceRoot: tmpDir });
    try {
      const result = await command.execute();

      expect(result.success).toBe(true);
      expect(result.filesRequested).toBeGreaterThanOrEqual(2); // index.ts + helper.ts

      const dbPath = path.join(tmpDir, ".docuvia", "local.db");
      expect(fs.existsSync(dbPath)).toBe(true);

      const raw = new DatabaseCtor(dbPath, { readonly: true });
      try {
        const tables = raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((r: any) => r.name);
        for (const expected of ["projects", "project_files", "l1_tags", "l2_nodes", "node_links"]) {
          expect(tables).toContain(expected);
        }

        const projectCount = raw.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number };
        expect(projectCount.c).toBe(1);

        const fileRows = raw.prepare("SELECT file_path FROM project_files").all() as {
          file_path: string;
        }[];
        const paths = fileRows.map((r) => r.file_path);
        expect(paths).toContain("index.ts");
        expect(paths).toContain("helper.ts");

        const nodeRows = raw.prepare("SELECT name FROM l2_nodes").all() as { name: string }[];
        expect(nodeRows.some((r) => r.name === "helper")).toBe(true);
      } finally {
        raw.close();
      }

      // Hidden knowledge-graph branch created.
      const branchOut = execFileSync("git", ["branch", "--list", "docuvia-knowledge"], {
        cwd: tmpDir,
      }).toString();
      expect(branchOut).toContain("docuvia-knowledge");

      // JSONL run log written.
      const logPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
      expect(fs.existsSync(logPath)).toBe(true);
      const lines = fs
        .readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(lines[0].event).toBe("init.start");
      expect(lines[lines.length - 1].event).toBe("init.summary");
    } finally {
      await command.dispose();
    }
  }, 60_000);

  it("is idempotent across two full runs: second run does not duplicate the projects row", async () => {
    const first = await buildInitCapability({ workspaceRoot: tmpDir });
    try {
      await first.execute();
    } finally {
      await first.dispose();
    }

    const second = await buildInitCapability({ workspaceRoot: tmpDir });
    try {
      const result = await second.execute();
      expect(result.success).toBe(true);
    } finally {
      await second.dispose();
    }

    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const raw = new DatabaseCtor(dbPath, { readonly: true });
    try {
      const projectCount = raw.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number };
      expect(projectCount.c).toBe(1);
    } finally {
      raw.close();
    }
  }, 60_000);
});
