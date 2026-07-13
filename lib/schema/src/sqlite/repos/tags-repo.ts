import type Database from "better-sqlite3";
import { DocuviaError, ErrorCodes, type ITagsRepo } from "@workspace/contracts";

/** `tags` repo — `l1_tags` upsert + `l2_node_l1_tags` linking (feature-sniffing tags detected during `init`). */
export class TagsRepo implements ITagsRepo {
  constructor(private readonly db: Database.Database) {}

  /** Inserts a tag by name if it doesn't already exist; no-ops on a name conflict. */
  upsertTag(name: string): void {
    this.db
      .prepare(
        `INSERT INTO l1_tags (name, slug, description)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO NOTHING`,
      )
      .run(name, name, `Auto-detected tag: ${name}`);
  }

  /** Looks up a tag's id by name. */
  getIdByName(name: string): number | undefined {
    const row = this.db
      .prepare("SELECT id FROM l1_tags WHERE name = ?")
      .get(name) as { id: number } | undefined;
    return row?.id;
  }

  /** Links an l2_node to an l1_tag (l2_node_l1_tags junction row). */
  linkNodeToTag(l2NodeId: number, l1TagId: number): void {
    this.db
      .prepare(
        "INSERT INTO l2_node_l1_tags (l2_node_id, l1_tag_id) VALUES (?, ?)",
      )
      .run(l2NodeId, l1TagId);
  }

  /** Every (l2NodeId, tagName) pairing — used by `export-topology` to tag file nodes. */
  getAllTagLinks(): Array<{ l2NodeId: number; name: string }> {
    try {
      const rows = this.db
        .prepare(
          `SELECT lt.l2_node_id as l2_node_id, t.name as name
           FROM l2_node_l1_tags lt
           JOIN l1_tags t ON t.id = lt.l1_tag_id`,
        )
        .all() as Array<{ l2_node_id: number; name: string }>;
      return rows.map((row) => ({ l2NodeId: row.l2_node_id, name: row.name }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to get all tag links",
        err,
      );
    }
  }
}
