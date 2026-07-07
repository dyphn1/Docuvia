// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import * as schema from "./index.js";
import {
  projectsTable,
  l1TagsTable,
  l2NodesTable,
  l3NodesTable,
  l3NodeSourceCommitsTable,
  l2NodeL1TagsTable,
} from "./index.js";

/**
 * Integration tests for the SQLite dialect schema.
 *
 * DDL is generated from the actual Drizzle schema definitions via
 * drizzle-kit/api, so these tests cannot drift from the schema files.
 * Runs against an in-memory better-sqlite3 database (no mocks in DB access).
 */

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

async function applySchema(target: Database.Database) {
  const emptySnapshot = await generateSQLiteDrizzleJson({});
  const currentSnapshot = await generateSQLiteDrizzleJson(schema);
  const statements = await generateSQLiteMigration(emptySnapshot, currentSnapshot);
  for (const statement of statements) {
    target.exec(statement);
  }
}

function seedProjectAndL2(database: ReturnType<typeof drizzle>) {
  const project = database
    .insert(projectsTable)
    .values({ name: "proj", repoUrl: "https://example.com/repo.git" })
    .returning()
    .get();
  const l2 = database
    .insert(l2NodesTable)
    .values({ projectId: project.id, name: "module-a" })
    .returning()
    .get();
  return { project, l2 };
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  await applySchema(sqlite);
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
});

describe("sqlite schema DDL", () => {
  it("creates all tables from the drizzle schema", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "projects",
        "l1_tags",
        "l2_nodes",
        "l3_nodes",
        "l3_node_source_commits",
        "l2_node_l1_tags",
        "node_links",
        "project_files",
      ])
    );
  });

  it("backs l1_tags.name and l1_tags.slug with unique indexes", () => {
    const indexes = sqlite.pragma("index_list('l1_tags')");
    const uniqueIndexes = indexes.filter((idx) => idx.unique === 1);
    const uniqueColumns = uniqueIndexes.flatMap((idx) =>
      sqlite.pragma(`index_info('${idx.name}')`).map((info) => info.name)
    );
    expect(uniqueColumns).toContain("name");
    expect(uniqueColumns).toContain("slug");
  });

  it("creates the l3_node_source_commits lookup indexes", () => {
    const indexes = sqlite.pragma("index_list('l3_node_source_commits')").map((idx) => idx.name);
    expect(indexes).toContain("l3_node_source_commits_commit_hash_idx");
    expect(indexes).toContain("l3_node_source_commits_l3_node_idx");
    expect(indexes).toContain("l3_node_source_commits_unique_idx");
  });
});

describe("l1_tags constraints and parity columns", () => {
  it("applies parity-column defaults (category, is_anchored, usage_count)", () => {
    const tag = db
      .insert(l1TagsTable)
      .values({ name: "auth", slug: "auth", description: "Authentication" })
      .returning()
      .get();
    expect(tag.category).toBe("Feature");
    expect(tag.isAnchored).toBe(false);
    expect(tag.usageCount).toBe(0);
  });

  it("rejects duplicate name and duplicate slug", () => {
    db.insert(l1TagsTable).values({ name: "auth", slug: "auth" }).run();
    expect(() => db.insert(l1TagsTable).values({ name: "auth", slug: "auth-2" }).run()).toThrow(
      /UNIQUE/
    );
    expect(() => db.insert(l1TagsTable).values({ name: "auth-2", slug: "auth" }).run()).toThrow(
      /UNIQUE/
    );
  });
});

describe("l3_node_source_commits relationships", () => {
  it("looks up l3 nodes by source commit hash through the junction table", () => {
    const { l2 } = seedProjectAndL2(db);
    const nodeA = db
      .insert(l3NodesTable)
      .values({ l2NodeId: l2.id, title: "Node A", sourceCommits: ["abc123", "def456"] })
      .returning()
      .get();
    const nodeB = db
      .insert(l3NodesTable)
      .values({ l2NodeId: l2.id, title: "Node B", sourceCommits: ["def456"] })
      .returning()
      .get();
    db.insert(l3NodeSourceCommitsTable)
      .values([
        { l3NodeId: nodeA.id, commitHash: "abc123" },
        { l3NodeId: nodeA.id, commitHash: "def456" },
        { l3NodeId: nodeB.id, commitHash: "def456" },
      ])
      .run();

    const hits = db
      .select({ l3NodeId: l3NodeSourceCommitsTable.l3NodeId, title: l3NodesTable.title })
      .from(l3NodeSourceCommitsTable)
      .innerJoin(l3NodesTable, eq(l3NodesTable.id, l3NodeSourceCommitsTable.l3NodeId))
      .where(eq(l3NodeSourceCommitsTable.commitHash, "def456"))
      .all();
    expect(hits.map((h) => h.title).sort()).toEqual(["Node A", "Node B"]);
  });

  it("rejects duplicate (l3_node_id, commit_hash) pairs", () => {
    const { l2 } = seedProjectAndL2(db);
    const node = db
      .insert(l3NodesTable)
      .values({ l2NodeId: l2.id, title: "Node" })
      .returning()
      .get();
    db.insert(l3NodeSourceCommitsTable).values({ l3NodeId: node.id, commitHash: "abc123" }).run();
    expect(() =>
      db.insert(l3NodeSourceCommitsTable).values({ l3NodeId: node.id, commitHash: "abc123" }).run()
    ).toThrow(/UNIQUE/);
  });

  it("rejects rows referencing a missing l3 node", () => {
    expect(() =>
      db.insert(l3NodeSourceCommitsTable).values({ l3NodeId: 9999, commitHash: "abc123" }).run()
    ).toThrow(/FOREIGN KEY/);
  });

  it("cascades deletes from l3_nodes and up the project chain", () => {
    const { project, l2 } = seedProjectAndL2(db);
    const node = db
      .insert(l3NodesTable)
      .values({ l2NodeId: l2.id, title: "Node" })
      .returning()
      .get();
    db.insert(l3NodeSourceCommitsTable).values({ l3NodeId: node.id, commitHash: "abc123" }).run();

    // Deleting the project cascades: projects -> l2_nodes -> l3_nodes -> l3_node_source_commits
    db.delete(projectsTable).where(eq(projectsTable.id, project.id)).run();
    expect(db.select().from(l3NodesTable).all()).toHaveLength(0);
    expect(db.select().from(l3NodeSourceCommitsTable).all()).toHaveLength(0);
  });
});

describe("l2_node_l1_tags relationships", () => {
  it("cascades deletes from both l2_nodes and l1_tags", () => {
    const { l2 } = seedProjectAndL2(db);
    const tag = db.insert(l1TagsTable).values({ name: "auth", slug: "auth" }).returning().get();
    db.insert(l2NodeL1TagsTable).values({ l2NodeId: l2.id, l1TagId: tag.id }).run();

    db.delete(l1TagsTable).where(eq(l1TagsTable.id, tag.id)).run();
    expect(db.select().from(l2NodeL1TagsTable).all()).toHaveLength(0);
  });
});
