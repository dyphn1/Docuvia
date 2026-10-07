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
    "source_index_json",
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
    "anchor_ranges",
  ],
  docuvia_meta: ["key", "value"],
  ast_call_sites: [
    "id",
    "project_id",
    "file_path",
    "target_function",
    "start_line",
    "start_column",
    "created_at",
    "callee_name",
    "receiver_text",
    "callee_kind",
  ],
  call_site_resolution_dependencies: [
    "project_id",
    "call_site_key",
    "dependency_path",
    "content_hash",
  ],
  call_site_rule_quarantines: [
    "project_id",
    "rule_signature",
    "policy_version",
    "reason",
    "call_site_key",
    "source_content_hash",
    "expected_target_node_key",
    "observed_target_node_key",
    "created_at",
    "rule_configuration_sha256",
  ],
  call_site_rule_quarantine_clear_audits: [
    "id",
    "project_id",
    "rule_signature",
    "quarantine_policy_version",
    "quarantine_reason",
    "quarantine_call_site_key",
    "quarantine_source_content_hash",
    "expected_target_node_key",
    "observed_target_node_key",
    "quarantine_created_at",
    "cleared_at",
    "clear_method",
    "evidence_sha256",
    "operator",
    "reason",
    "previous_rule_configuration_sha256",
    "new_rule_configuration_sha256",
  ],
};

const EXPECTED_FTS_TABLES = ["l2_nodes_fts", "l3_nodes_fts"];

const EXPECTED_COLUMN_TYPES: Record<string, Record<string, string>> = {
  projects: {
    id: "INTEGER",
    name: "TEXT",
    repo_url: "TEXT",
    status: "TEXT",
    vcs_type: "TEXT",
    created_at: "TEXT",
    updated_at: "TEXT",
  },
  l2_nodes: {
    id: "INTEGER",
    project_id: "INTEGER",
    name: "TEXT",
    type: "TEXT",
    ai_generated: "INTEGER",
    created_at: "TEXT",
    path_patterns: "TEXT",
  },
  node_links: {
    id: "INTEGER",
    source_node_id: "INTEGER",
    target_node_id: "INTEGER",
    link_type: "TEXT",
    commit_sha: "TEXT",
    created_at: "TEXT",
  },
  l3_nodes: {
    id: "INTEGER",
    l2_node_id: "INTEGER",
    title: "TEXT",
    content: "TEXT",
    node_type: "TEXT",
    source_commits: "TEXT",
    commit_hash: "TEXT",
    ai_generated: "INTEGER",
    confidence: "REAL",
    occurrence_count: "INTEGER",
    validity_status: "TEXT",
    source: "TEXT",
    content_hash: "TEXT",
  },
  ast_call_sites: {
    id: "INTEGER",
    project_id: "INTEGER",
    file_path: "TEXT",
    target_function: "TEXT",
    start_line: "INTEGER",
    start_column: "INTEGER",
    callee_name: "TEXT",
    receiver_text: "TEXT",
    callee_kind: "TEXT",
  },
  call_site_resolution_dependencies: {
    project_id: "INTEGER",
    call_site_key: "TEXT",
    dependency_path: "TEXT",
    content_hash: "TEXT",
  },
  call_site_rule_quarantines: {
    project_id: "INTEGER",
    rule_signature: "TEXT",
    policy_version: "TEXT",
    reason: "TEXT",
    call_site_key: "TEXT",
    source_content_hash: "TEXT",
    expected_target_node_key: "TEXT",
    observed_target_node_key: "TEXT",
    created_at: "TEXT",
    rule_configuration_sha256: "TEXT",
  },
  call_site_rule_quarantine_clear_audits: {
    id: "INTEGER",
    project_id: "INTEGER",
    rule_signature: "TEXT",
    quarantine_policy_version: "TEXT",
    quarantine_reason: "TEXT",
    quarantine_call_site_key: "TEXT",
    quarantine_source_content_hash: "TEXT",
    expected_target_node_key: "TEXT",
    observed_target_node_key: "TEXT",
    quarantine_created_at: "TEXT",
    cleared_at: "TEXT",
    clear_method: "TEXT",
    evidence_sha256: "TEXT",
    operator: "TEXT",
    reason: "TEXT",
    previous_rule_configuration_sha256: "TEXT",
    new_rule_configuration_sha256: "TEXT",
  },
};

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

      const pragmaRows = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      const columns = pragmaRows.map((c) => c.name);
      expect(columns.sort()).toEqual([...expectedColumns].sort());

      const expectedTypes = EXPECTED_COLUMN_TYPES[table];
      if (expectedTypes) {
        for (const [colName, expectedType] of Object.entries(expectedTypes)) {
          const col = pragmaRows.find((c) => c.name === colName);
          expect(
            col,
            `expected column "${colName}" in table "${table}" to exist`,
          ).toBeDefined();
          expect(
            col!.type,
            `expected column "${colName}" in table "${table}" to have type "${expectedType}"`,
          ).toBe(expectedType);
        }
      }
    }

    for (const table of EXPECTED_FTS_TABLES) {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table);
      expect(row, `expected FTS5 table "${table}" to exist`).toBeDefined();
      expect(
        (row as { name: string }).name,
        `expected FTS5 table "${table}" name to match`,
      ).toBe(table);
    }
  });

  it("enforces identity constraints at the DDL level (issue #232)", () => {
    applyMigrations(db, MIGRATIONS_DIR);

    // (project_id, node_key) uniqueness — the invariant the graph layer relies on
    // instead of application-level dedup.
    const uniqueIdx = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'l2_nodes_project_id_node_key_idx'",
      )
      .get() as { sql: string } | undefined;
    expect(uniqueIdx).toBeDefined();
    expect(uniqueIdx!.sql).toMatch(/UNIQUE/i);

    // Link endpoint lookup indexes — without these, blast-radius traversals scan.
    for (const [idx, column] of [
      ["node_links_source_node_idx", "source_node_id"],
      ["node_links_target_node_idx", "target_node_id"],
    ] as const) {
      const row = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get(idx) as { sql: string } | undefined;
      expect(row, `expected index "${idx}" to exist`).toBeDefined();
      expect(row!.sql).toContain(column);
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
      "0008_ast_call_sites.sql",
      "0009_l2_node_key_lookup_index.sql",
      "0010_l3_anchor_ranges.sql",
      "0011_ast_call_sites_target_idx.sql",
      "0012_ast_call_sites_callee_fields.sql",
      "0013_call_site_resolutions.sql",
      "0014_call_site_resolution_dependencies.sql",
      "0015_call_site_rule_quarantines.sql",
      "0016_call_site_projection_callers.sql",
      "0017_verified_call_site_targets.sql",
      "0018_call_site_rule_quarantine_recertification.sql",
      "0019_call_resolution_source_index.sql",
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

  it("0009: adds a standalone node_key index so node_key-only lookups SEARCH instead of scanning the composite (project_id, node_key) index cover", () => {
    applyMigrations(db, MIGRATIONS_DIR);

    const index = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'l2_nodes_node_key_idx'",
      )
      .get();
    expect(index).toBeDefined();
    expect((index as { name: string }).name).toBe("l2_nodes_node_key_idx");

    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM l2_nodes WHERE node_key = 'src/a.ts'",
      )
      .all() as { detail: string }[];
    // A node_key-only predicate must be served by the dedicated index, not as a
    // covering scan over the composite (leading project_id) index.
    expect(plan.map((r) => r.detail).join("|")).toContain(
      "l2_nodes_node_key_idx",
    );
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
    expect(migrationRows).toHaveLength(19);

    const projectRows = db.prepare("SELECT * FROM projects").all();
    expect(projectRows).toHaveLength(1);
  });

  it("[state-diff] preserves current resolution and supporting data across the target-selection table rebuild", () => {
    const legacyMigrationsDir = path.join(
      path.dirname(dbPath),
      "migrations-before-phase4",
    );
    fs.mkdirSync(legacyMigrationsDir);
    for (const filename of fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(
        (entry) =>
          entry.endsWith(".sql") &&
          entry !== "0017_verified_call_site_targets.sql",
      )) {
      fs.copyFileSync(
        path.join(MIGRATIONS_DIR, filename),
        path.join(legacyMigrationsDir, filename),
      );
    }

    db.pragma("foreign_keys = ON");
    applyMigrations(db, legacyMigrationsDir);
    const projectId = Number(
      db
        .prepare("INSERT INTO projects (name, repo_url) VALUES (?, ?)")
        .run("migration-preservation", "file:///migration-preservation")
        .lastInsertRowid,
    );
    const callSiteKey = "call-site:v1:migration-preservation";
    db.prepare(
      `INSERT INTO call_site_resolutions (
        project_id, call_site_key, identity_version, file_path,
        source_content_hash, start_line, start_column, callee_kind,
        callee_name, caller_node_key, resolution_class,
        selected_target_node_key, confidence, resolver, rule_signature,
        dependency_fingerprint, verification_status, verified_target_node_key,
        is_stale
      ) VALUES (?, ?, 1, ?, ?, 4, 5, 'identifier', 'run', ?, 'proven', ?, NULL,
                'strict-proof', 'rule-v1', ?, 'unverified', NULL, 0)`,
    ).run(
      projectId,
      callSiteKey,
      "src/caller.ts",
      "a".repeat(64),
      "src/caller.ts#caller",
      "src/target.ts#run",
      "b".repeat(64),
    );
    db.prepare(
      `INSERT INTO call_site_resolution_candidates
        (project_id, call_site_key, ordinal, target_node_key, evidence_json)
       VALUES (?, ?, 0, ?, '{}')`,
    ).run(projectId, callSiteKey, "src/target.ts#run");
    db.prepare(
      `INSERT INTO call_site_resolution_dependencies
        (project_id, call_site_key, dependency_path, content_hash)
       VALUES (?, ?, ?, ?)`,
    ).run(projectId, callSiteKey, "src/target.ts", "c".repeat(64));
    db.prepare(
      `INSERT INTO call_site_resolution_projection_callers
        (project_id, call_site_key, caller_node_key)
       VALUES (?, ?, ?)`,
    ).run(projectId, callSiteKey, "src/scope-caller.ts#caller");
    db.prepare(
      `INSERT INTO call_site_resolution_observations (
        project_id, call_site_key, file_path, source_content_hash, source,
        resolution_class, target_node_key, resolver, rule_signature, evidence_json
      ) VALUES (?, ?, ?, ?, 'strict-proof', 'proven', ?, 'strict-proof',
                'rule-v1', '{}')`,
    ).run(
      projectId,
      callSiteKey,
      "src/caller.ts",
      "a".repeat(64),
      "src/target.ts#run",
    );
    db.prepare(
      `INSERT INTO call_site_rule_quarantines (
        project_id, rule_signature, policy_version, reason, call_site_key,
        source_content_hash, expected_target_node_key, observed_target_node_key
      ) VALUES (?, 'other-rule-v1', 'sha256-callsite-rule-v2',
                'tier-b-target-mismatch', ?, ?, ?, ?)`,
    ).run(
      projectId,
      callSiteKey,
      "a".repeat(64),
      "src/expected.ts#run",
      "src/observed.ts#run",
    );

    applyMigrations(db, MIGRATIONS_DIR);

    expect(
      db
        .prepare(
          `SELECT call_site_key, resolution_class, selected_target_node_key,
                  rule_signature, verification_status
           FROM call_site_resolutions WHERE project_id = ?`,
        )
        .all(projectId),
    ).toEqual([
      {
        call_site_key: callSiteKey,
        resolution_class: "proven",
        selected_target_node_key: "src/target.ts#run",
        rule_signature: "rule-v1",
        verification_status: "unverified",
      },
    ]);
    expect(
      db
        .prepare(
          `SELECT ordinal, target_node_key, evidence_json
           FROM call_site_resolution_candidates WHERE project_id = ?`,
        )
        .all(projectId),
    ).toEqual([
      {
        ordinal: 0,
        target_node_key: "src/target.ts#run",
        evidence_json: "{}",
      },
    ]);
    expect(
      db
        .prepare(
          `SELECT dependency_path, content_hash
           FROM call_site_resolution_dependencies WHERE project_id = ?`,
        )
        .all(projectId),
    ).toEqual([
      { dependency_path: "src/target.ts", content_hash: "c".repeat(64) },
    ]);
    expect(
      db
        .prepare(
          `SELECT caller_node_key
           FROM call_site_resolution_projection_callers WHERE project_id = ?`,
        )
        .all(projectId),
    ).toEqual([{ caller_node_key: "src/scope-caller.ts#caller" }]);
    expect(
      db
        .prepare(
          `SELECT source, resolution_class, target_node_key
           FROM call_site_resolution_observations WHERE project_id = ?`,
        )
        .all(projectId),
    ).toEqual([
      {
        source: "strict-proof",
        resolution_class: "proven",
        target_node_key: "src/target.ts#run",
      },
    ]);
    expect(
      db
        .prepare(
          `SELECT rule_signature, reason, observed_target_node_key,
                  rule_configuration_sha256
           FROM call_site_rule_quarantines WHERE project_id = ?`,
        )
        .all(projectId),
    ).toEqual([
      {
        rule_signature: "other-rule-v1",
        reason: "tier-b-target-mismatch",
        observed_target_node_key: "src/observed.ts#run",
        rule_configuration_sha256: null,
      },
    ]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
