import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AnalyzeService } from "../../src/services/analyze-service.js";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { resolve, join } from "path";
import Database from "better-sqlite3";
import fs from "fs";

describe("AnalyzeService (Core Integration)", () => {
  let tmpDir: string;
  let analyzeService: AnalyzeService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(resolve(tmpdir(), "docuvia-core-analyze-test-"));
    // Setup a mock workspace
    const pkgJson = JSON.stringify({
      name: "mock-core-app",
      dependencies: { react: "^18.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    });

    await writeFile(join(tmpDir, "package.json"), pkgJson, "utf-8");

    // Create a mock source file
    const srcDir = join(tmpDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(tmpDir, "src/index.ts"), "export const hello = () => 'world';", "utf-8");

    // Initialize DB manually like init-service would to provide a valid starting state
    const docuviaDir = join(tmpDir, ".docuvia");
    await mkdir(docuviaDir, { recursive: true });
    const dbPath = join(docuviaDir, "local.db");
    const db = new Database(dbPath);

    // Create necessary schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        file_path TEXT,
        content_hash TEXT,
        last_parsed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, file_path)
      );
      CREATE TABLE IF NOT EXISTS l1_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS l2_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        name TEXT,
        slug TEXT,
        type TEXT,
        is_system INTEGER DEFAULT 0,
        description TEXT,
        ai_generated INTEGER DEFAULT 1,
        needs_review INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
        path_patterns TEXT,
        reindex_required INTEGER DEFAULT 0,
        is_bootstrap_confirmed INTEGER DEFAULT 0,
        content_hash TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS node_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_node_id INTEGER,
        target_node_id INTEGER,
        link_type TEXT,
        commit_sha TEXT,
        diff_summary TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS l2_node_l1_tags (
        l2_node_id INTEGER,
        l1_tag_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.close();

    analyzeService = new AnalyzeService(tmpDir);
  });

  afterEach(async () => {
    // Attempt to cleanly shutdown any worker threads to avoid hanging process
    if (
      (analyzeService as any).astProcessor &&
      typeof (analyzeService as any).astProcessor.dispose === "function"
    ) {
      await (analyzeService as any).astProcessor.dispose();
    }

    if (tmpDir && fs.existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("should analyze project directly and update graph database natively", async () => {
    // Act
    // By calling the service directly instead of via child_process,
    // any errors will have a proper stack trace in Vitest output.
    const result = await analyzeService.analyzeProject();

    // Assert
    expect(result.projectType).toBe("javascript");
    expect(result.suggestedTags).toContain("typescript");
    expect(result.suggestedTags).toContain("react");
    expect(result.suggestedTags).toContain("frontend");

    // Verify database was actually updated
    const db = new Database(join(tmpDir, ".docuvia/local.db"));
    const files = db.prepare("SELECT * FROM project_files").all();
    expect(files.length).toBeGreaterThan(0);

    const nodes = db.prepare("SELECT * FROM l2_nodes").all();
    expect(nodes.length).toBeGreaterThan(0);
    db.close();
  }, 30000);
});
