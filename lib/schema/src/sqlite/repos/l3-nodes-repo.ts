import crypto from "node:crypto";
import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IL3NodesRepo,
  type L3NodeRow,
} from "@workspace/contracts";

/** `content_hash` = sha256 over `nodeType + "\n" + title + "\n" + content` (phase1-decision-integration.md §3c). */
function computeContentHash(
  nodeType: string,
  title: string,
  content: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`${nodeType}\n${title}\n${content}`)
    .digest("hex");
}

/**
 * `l3` repo — `l3_nodes` (AI-generated decisions) persistence, including the content-hash upsert
 * `analyze <targetPath>`'s LLM decision-extraction pipeline writes through
 * (phase1-decision-integration.md §3c/§3d; PLAT-007 Tier C point 1).
 */
export class L3NodesRepo implements IL3NodesRepo {
  constructor(private readonly db: Database.Database) {}

  getById(id: number): L3NodeRow | undefined {
    try {
      return this.db.prepare("SELECT * FROM l3_nodes WHERE id = ?").get(id) as
        L3NodeRow | undefined;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to get l3 node by id ${id}`,
        err,
      );
    }
  }

  /** Excludes stale/superseded decisions (`validity_status = 'garbage'`) — used by `export-topology`. */
  getAllExportable(): L3NodeRow[] {
    try {
      return this.db
        .prepare("SELECT * FROM l3_nodes WHERE validity_status != 'garbage'")
        .all() as L3NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to get all exportable l3 nodes",
        err,
      );
    }
  }

  /** See `IL3NodesRepo.upsertDecision`'s doc comment for the full dedup contract. */
  upsertDecision(input: {
    projectId: number;
    l2NodeId: number;
    title: string;
    content: string;
    nodeType: string;
    confidence: number;
    commitSha: string | null;
    extractionModel: string | null;
    sourceFiles: string[];
  }): { id: number; deduped: boolean } {
    try {
      const contentHash = computeContentHash(
        input.nodeType,
        input.title,
        input.content,
      );

      const run = this.db.transaction(() => {
        const existing = this.db
          .prepare(
            `SELECT l3.* FROM l3_nodes l3
             JOIN l2_nodes l2 ON l2.id = l3.l2_node_id
             WHERE l2.project_id = ? AND l3.content_hash = ?
             LIMIT 1`,
          )
          .get(input.projectId, contentHash) as L3NodeRow | undefined;

        if (existing) {
          const sourceCommits: string[] = existing.source_commits
            ? JSON.parse(existing.source_commits)
            : [];
          if (input.commitSha && !sourceCommits.includes(input.commitSha)) {
            sourceCommits.push(input.commitSha);
          }
          this.db
            .prepare(
              `UPDATE l3_nodes
               SET occurrence_count = occurrence_count + 1,
                   last_verified_at = CURRENT_TIMESTAMP,
                   source_commits = ?
               WHERE id = ?`,
            )
            .run(JSON.stringify(sourceCommits), existing.id);
          return { id: existing.id, deduped: true };
        }

        const result = this.db
          .prepare(
            `INSERT INTO l3_nodes
               (l2_node_id, title, content, node_type, source_commits, commit_hash,
                ai_generated, confidence, source, content_hash, extraction_model, source_files)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'analyze', ?, ?, ?)`,
          )
          .run(
            input.l2NodeId,
            input.title,
            input.content,
            input.nodeType,
            JSON.stringify(input.commitSha ? [input.commitSha] : []),
            input.commitSha,
            input.confidence,
            contentHash,
            input.extractionModel,
            JSON.stringify(input.sourceFiles),
          );
        return { id: Number(result.lastInsertRowid), deduped: false };
      });

      return run();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to upsert l3 decision",
        err,
      );
    }
  }
}
