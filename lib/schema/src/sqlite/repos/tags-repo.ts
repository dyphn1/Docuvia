import type Database from "better-sqlite3";
import { DocuviaError, ErrorCodes, type ITagsRepo } from "@workspace/contracts";
import { SchemaTables, SchemaColumns } from "../constants.js";

const TAGS_REPO_MESSAGES = {
  AUTO_DETECTED_TAG_DESCRIPTION: (name: string) => `Auto-detected tag: ${name}`,
  GET_ALL_TAG_LINKS_FAILED: "Failed to get all tag links",
} as const;

/** `tags` repo — `l1_tags` upsert + `l2_node_l1_tags` linking (feature-sniffing tags detected during `init`). */
export class TagsRepo implements ITagsRepo {
  constructor(private readonly db: Database.Database) {}

  /** Inserts a tag by name if it doesn't already exist; no-ops on a name conflict. */
  upsertTag(name: string): void {
    this.db
      .prepare(
        `INSERT INTO ${SchemaTables.L1_TAGS} (name, slug, description)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO NOTHING`,
      )
      .run(name, name, TAGS_REPO_MESSAGES.AUTO_DETECTED_TAG_DESCRIPTION(name));
  }

  /** Looks up a tag's id by name. */
  getIdByName(name: string): number | undefined {
    const row = this.db
      .prepare(`SELECT id FROM ${SchemaTables.L1_TAGS} WHERE name = ?`)
      .get(name) as { id: number } | undefined;
    return row?.id;
  }

  /** Links an l2_node to an l1_tag (l2_node_l1_tags junction row). */
  linkNodeToTag(l2NodeId: number, l1TagId: number): void {
    this.db
      .prepare(
        `INSERT INTO ${SchemaTables.L2_NODE_L1_TAGS} (${SchemaColumns.L2_NODE_ID}, ${SchemaColumns.L1_TAG_ID}) VALUES (?, ?)`,
      )
      .run(l2NodeId, l1TagId);
  }

  /** Every (l2NodeId, tagName) pairing — used by `export-topology` to tag file nodes. */
  getAllTagLinks(): Array<{ l2NodeId: number; name: string }> {
    try {
      const rows = this.db
        .prepare(
          `SELECT lt.${SchemaColumns.L2_NODE_ID} as ${SchemaColumns.L2_NODE_ID}, t.name as name
           FROM ${SchemaTables.L2_NODE_L1_TAGS} lt
           JOIN ${SchemaTables.L1_TAGS} t ON t.id = lt.${SchemaColumns.L1_TAG_ID}`,
        )
        .all() as Array<{ l2_node_id: number; name: string }>;
      return rows.map((row) => ({ l2NodeId: row.l2_node_id, name: row.name }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        TAGS_REPO_MESSAGES.GET_ALL_TAG_LINKS_FAILED,
        err,
      );
    }
  }
}
