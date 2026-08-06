import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migration-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

const EXPECTED_TABLES: Record<string, string[]> = {
  projects: [
    "id",
    "name",
    "repo_url",
    "description",
    "status",
    "vcs_type",
    "svn_url",
    "last_git_ingested_at",
    "last_svn_revision",
    "last_ast_ingested_at",
    "owner_id",
    "created_at",
    "updated_at",
  ],
  project_files: [
    "id",
    "project_id",
    "file_path",
    "content_hash",
    "last_parsed_at",
    "created_at",
    "last_tier_b_processed_at",
    "last_tier_b_commit_sha",
  ],
  l1_tags: [
    "id",
    "name",
    "slug",
    "category",
    "is_anchored",
    "usage_count",
    "description",
    "created_at",
  ],
  l2_nodes: [
    "id",
    "project_id",
    "name",
    "type",
    "is_system",
    "description",
    "ai_generated",
    "needs_review",
    "created_at",
    "last_verified_at",
    "path_patterns",
    "reindex_required",
    "is_bootstrap_confirmed",
    "content_hash",
    "updated_at",
    "node_key",
  ],
  node_links: [
    "id",
    "source_node_id",
    "target_node_id",
    "link_type",
    "commit_sha",
    "diff_summary",
    "created_at",
  ],
  l2_node_l1_tags: ["l2_node_id", "l1_tag_id", "created_at"],
  l3_nodes: [
    "id",
    "l2_node_id",
    "title",
    "content",
    "node_type",
    "source_commits",
    "commit_hash",
    "ai_generated",
    "confidence",
    "noise_score",
    "created_at",
    "last_verified_at",
    "occurrence_count",
    "introduced_in_commit",
    "verified_until_commit",
    "validity_status",
    "source",
    "content_hash",
    "extraction_model",
    "source_files",
    "initial_source_commits",
  ],
  docuvia_meta: ["key", "value"],
};

const EXPECTED_FTS_TABLES = ["l2_nodes_fts", "l3_nodes_fts"];

describe("applyMigrations", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-schema-")),
      "local.db",
    );
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("creates every table from the migration with the expected columns", () => {
    applyMigrations(db, MIGRATIONS_DIR);

    for (const [table, expectedColumns] of Object.entries(EXPECTED_TABLES)) {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table);
      expect(row, `expected table "${table}" to exist`).toBeDefined();

      const columns = (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name);
      expect(columns.sort()).toEqual([...expectedColumns].sort());
    }

    for (const table of EXPECTED_FTS_TABLES) {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table);
      expect(row, `expected FTS5 table "${table}" to exist`).toBeDefined();
    }
  });

  it("records applied migrations in schema_migrations", () => {
    applyMigrations(db, MIGRATIONS_DIR);

    const rows = db.prepare("SELECT filename FROM schema_migrations").all() as {
      filename: string;
    }[];
    expect(rows.map((r) => r.filename)).toEqual([
      "0001_init.sql",
      "0002_l2_node_key.sql",
      "0003_docuvia_meta.sql",
      "0004_l3_provenance.sql",
      "0005_l3_initial_source_commits.sql",
      "0006_tier_b_file_status.sql",
      "0007_fts_porter_stemming.sql",
    ]);
  });

  it("0007: rebuilds l2_nodes_fts/l3_nodes_fts with a porter stemmer, closing the singular/plural token gap (roadmap-and-open-items.md item 25)", () => {
    applyMigrations(db, MIGRATIONS_DIR);

    db.prepare("INSERT INTO projects (name, repo_url) VALUES (?, ?)").run(
      "demo",
      "file:///demo",
    );
    db.prepare(
      "INSERT INTO l2_nodes (project_id, name, type, description, path_patterns) VALUES (1, 'queryCommand', 'module', '', '[\"artifacts/cli/src/commands/query.ts\"]')",
    ).run();

    // "commands" (plural, from the path) and "command" (singular, the query keyword) must be
    // treated as the same stem — the whole point of switching tokenizers.
    const rows = db
      .prepare(
        `SELECT n.name FROM l2_nodes_fts f JOIN l2_nodes n ON n.id = f.rowid
         WHERE l2_nodes_fts MATCH '"query" AND "command"'`,
      )
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["queryCommand"]);
  });

  it("is a no-op on a second run: does not re-apply and does not error", () => {
    applyMigrations(db, MIGRATIONS_DIR);
    // A working table + row so a naive re-run (e.g. re-running CREATE TABLE
    // without IF NOT EXISTS, or re-inserting a UNIQUE row) would throw.
    db.prepare("INSERT INTO projects (name, repo_url) VALUES (?, ?)").run(
      "demo",
      "file:///demo",
    );

    expect(() => applyMigrations(db, MIGRATIONS_DIR)).not.toThrow();

    const migrationRows = db
      .prepare("SELECT filename FROM schema_migrations")
      .all();
    expect(migrationRows).toHaveLength(7);

    const projectRows = db.prepare("SELECT * FROM projects").all();
    expect(projectRows).toHaveLength(1);
  });
});
