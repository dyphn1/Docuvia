import type Database from "better-sqlite3";

/** `tags` repo — `l1_tags` upsert + `l2_node_l1_tags` linking (feature-sniffing tags detected during `init`). */
export class TagsRepo {
  constructor(private readonly db: Database.Database) {}

  /** Inserts a tag by name if it doesn't already exist; no-ops on a name conflict. */
  upsertTag(name: string): void {
    this.db
      .prepare(
        `INSERT INTO l1_tags (name, slug, description)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO NOTHING`
      )
      .run(name, name, `Auto-detected tag: ${name}`);
  }

  /** Looks up a tag's id by name. */
  getIdByName(name: string): number | undefined {
    const row = this.db.prepare("SELECT id FROM l1_tags WHERE name = ?").get(name) as
      | { id: number }
      | undefined;
    return row?.id;
  }

  /** Links an l2_node to an l1_tag (l2_node_l1_tags junction row). */
  linkNodeToTag(l2NodeId: number, l1TagId: number): void {
    this.db
      .prepare("INSERT INTO l2_node_l1_tags (l2_node_id, l1_tag_id) VALUES (?, ?)")
      .run(l2NodeId, l1TagId);
  }
}
