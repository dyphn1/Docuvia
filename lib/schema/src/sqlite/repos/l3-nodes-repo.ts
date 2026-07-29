import crypto from "node:crypto";
import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IL3NodesRepo,
  type L3NodeRow,
  ValidityStatuses,
} from "@workspace/contracts";
import { SchemaTables, SchemaColumns } from "../constants.js";

const L3_NODES_ERROR_MESSAGES = {
  GET_BY_ID_FAILED: (id: number) => `Failed to get l3 node by id ${id}`,
  GET_ALL_EXPORTABLE_FAILED: "Failed to get all exportable l3 nodes",
  GET_BY_L2_NODE_ID_FAILED: (l2NodeId: number) =>
    `Failed to get l3 nodes for l2_node_id ${l2NodeId}`,
  UPSERT_DECISION_FAILED: "Failed to upsert l3 decision",
  IMPORT_CARD_FAILED: "Failed to import l3 card",
} as const;

/** `l3_nodes.source` value stamped by the `analyze <targetPath>` decision-extraction pipeline (see `IL3NodesRepo.upsertDecision`'s doc comment). */
const L3_DECISION_SOURCE = "analyze" as const;
/** `l3_nodes.source` value stamped by `IL3NodesRepo.importCard` (phase2-l3-distribution.md L3DIST-007) — distinguishes a row this developer authored locally from one absorbed from a teammate's card via `hydrate`/`sync-knowledge`. */
const L3_IMPORT_SOURCE = "git-import" as const;

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
      return this.db
        .prepare(`SELECT * FROM ${SchemaTables.L3_NODES} WHERE id = ?`)
        .get(id) as L3NodeRow | undefined;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        L3_NODES_ERROR_MESSAGES.GET_BY_ID_FAILED(id),
        err,
      );
    }
  }

  /** Excludes stale/superseded decisions (`validity_status = 'garbage'`) — used by `export-topology`. */
  getAllExportable(): L3NodeRow[] {
    try {
      return this.db
        .prepare(
          `SELECT * FROM ${SchemaTables.L3_NODES} WHERE validity_status != '${ValidityStatuses.GARBAGE}'`,
        )
        .all() as L3NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        L3_NODES_ERROR_MESSAGES.GET_ALL_EXPORTABLE_FAILED,
        err,
      );
    }
  }

  /** See `IL3NodesRepo.getByL2NodeId`'s doc comment. */
  getByL2NodeId(l2NodeId: number): L3NodeRow[] {
    try {
      return this.db
        .prepare(
          `SELECT * FROM ${SchemaTables.L3_NODES} WHERE ${SchemaColumns.L2_NODE_ID} = ?`,
        )
        .all(l2NodeId) as L3NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        L3_NODES_ERROR_MESSAGES.GET_BY_L2_NODE_ID_FAILED(l2NodeId),
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
            `SELECT l3.* FROM ${SchemaTables.L3_NODES} l3
             JOIN ${SchemaTables.L2_NODES} l2 ON l2.id = l3.${SchemaColumns.L2_NODE_ID}
             WHERE l2.${SchemaColumns.PROJECT_ID} = ? AND l3.${SchemaColumns.CONTENT_HASH} = ?
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
              `UPDATE ${SchemaTables.L3_NODES}
               SET occurrence_count = occurrence_count + 1,
                   last_verified_at = CURRENT_TIMESTAMP,
                   source_commits = ?
               WHERE id = ?`,
            )
            .run(JSON.stringify(sourceCommits), existing.id);
          this.db
            .prepare(
              `INSERT INTO ${SchemaTables.DOCUVIA_META} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            )
            .run("tierCProcessedThisRun", "true");
          return { id: existing.id, deduped: true };
        }

        const initialSourceCommits = JSON.stringify(
          input.commitSha ? [input.commitSha] : [],
        );
        const result = this.db
          .prepare(
            `INSERT INTO ${SchemaTables.L3_NODES}
               (${SchemaColumns.L2_NODE_ID}, title, content, node_type, source_commits,
                initial_source_commits, commit_hash, ai_generated, confidence, source,
                ${SchemaColumns.CONTENT_HASH}, extraction_model, source_files)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, '${L3_DECISION_SOURCE}', ?, ?, ?)`,
          )
          .run(
            input.l2NodeId,
            input.title,
            input.content,
            input.nodeType,
            initialSourceCommits,
            initialSourceCommits,
            input.commitSha,
            input.confidence,
            contentHash,
            input.extractionModel,
            JSON.stringify(input.sourceFiles),
          );
        this.db
          .prepare(
            `INSERT INTO ${SchemaTables.DOCUVIA_META} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run("tierCProcessedThisRun", "true");
        return { id: Number(result.lastInsertRowid), deduped: false };
      });

      return run();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        L3_NODES_ERROR_MESSAGES.UPSERT_DECISION_FAILED,
        err,
      );
    }
  }

  /** See `IL3NodesRepo.importCard`'s doc comment for the full dedup contract. */
  importCard(input: {
    l2NodeId: number;
    contentHash: string;
    title: string;
    content: string;
    nodeType: string;
    sourceCommits: string[];
    extractionModel: string | null;
    sourceFiles: string[];
    createdAt: string;
  }): { id: number; imported: boolean } {
    try {
      const run = this.db.transaction(() => {
        const existing = this.db
          .prepare(
            `SELECT l3.* FROM ${SchemaTables.L3_NODES} l3
             JOIN ${SchemaTables.L2_NODES} l2 ON l2.id = l3.${SchemaColumns.L2_NODE_ID}
             WHERE l2.${SchemaColumns.PROJECT_ID} = (
               SELECT ${SchemaColumns.PROJECT_ID} FROM ${SchemaTables.L2_NODES} WHERE id = ?
             ) AND l3.${SchemaColumns.CONTENT_HASH} = ?
             LIMIT 1`,
          )
          .get(input.l2NodeId, input.contentHash) as L3NodeRow | undefined;

        if (existing) {
          return { id: existing.id, imported: false };
        }

        const sourceCommitsJson = JSON.stringify(input.sourceCommits);
        const result = this.db
          .prepare(
            `INSERT INTO ${SchemaTables.L3_NODES}
               (${SchemaColumns.L2_NODE_ID}, title, content, node_type, source_commits,
                initial_source_commits, ai_generated, source, ${SchemaColumns.CONTENT_HASH},
                extraction_model, source_files, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, '${L3_IMPORT_SOURCE}', ?, ?, ?, ?)`,
          )
          .run(
            input.l2NodeId,
            input.title,
            input.content,
            input.nodeType,
            sourceCommitsJson,
            sourceCommitsJson,
            input.contentHash,
            input.extractionModel,
            JSON.stringify(input.sourceFiles),
            input.createdAt,
          );
        // Mirrors `upsertDecision`'s identical write: signals `snapshot`'s `shouldSkipSnapshot`
        // (SnapshotWorkflow) that `l3_nodes` gained content this run, so a subsequent snapshot
        // isn't wrongly skipped by its headSha-already-stamped heuristic -- `hasSourceCommitInHistory`
        // scans the *whole* knowledge-branch ancestry, so it can find this developer's own older
        // stamped commit even when the current tip (e.g. after a tree-adoption merge) doesn't yet
        // reflect a just-imported teammate's card (L3DIST-005/006/007's self-healing dance).
        this.db
          .prepare(
            `INSERT INTO ${SchemaTables.DOCUVIA_META} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run("tierCProcessedThisRun", "true");
        return { id: Number(result.lastInsertRowid), imported: true };
      });

      return run();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        L3_NODES_ERROR_MESSAGES.IMPORT_CARD_FAILED,
        err,
      );
    }
  }
}
