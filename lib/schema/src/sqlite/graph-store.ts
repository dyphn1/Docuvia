import fs from "node:fs";
import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import type { GraphStoreOpenOptions, IGraphStore } from "@workspace/contracts";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { applyMigrations } from "./migration-runner.js";
import { MIGRATIONS_DIR } from "./paths.js";
import { ReadWriteLock } from "./read-write-lock.js";
import { ProjectsRepo } from "./repos/projects-repo.js";
import { ProjectFilesRepo } from "./repos/files-repo.js";
import { TagsRepo } from "./repos/tags-repo.js";
import { GraphNodesRepo } from "./repos/graph-repo.js";
import { L3NodesRepo } from "./repos/l3-nodes-repo.js";
import { FtsRepo } from "./repos/fts-repo.js";
import { MetaRepo } from "./repos/meta-repo.js";

/**
 * The shared memory/state layer (see docs/gitbook/architecture/virtual-contracts-architecture.md
 * — this is the Technology Provider wrapping SQLite/better-sqlite3). One `GraphStore` per
 * `dbPath` per process, opened once by the Orchestration layer (`lib/ui-core`) and passed down
 * to every domain service that needs data access via the narrow repo interfaces. Lifecycle
 * (`close()`) is owned by the Orchestration layer only — no other layer closes it.
 */
export class GraphStore implements IGraphStore {
  private readonly lock = new ReadWriteLock();
  private readonly projectsRepo: ProjectsRepo;
  private readonly filesRepo: ProjectFilesRepo;
  private readonly tagsRepo: TagsRepo;
  private readonly graphRepo: GraphNodesRepo;
  private readonly l3Repo: L3NodesRepo;
  private readonly ftsRepo: FtsRepo;
  private readonly metaRepo: MetaRepo;

  private constructor(private readonly db: Database.Database) {
    this.projectsRepo = new ProjectsRepo(db);
    this.filesRepo = new ProjectFilesRepo(db);
    this.tagsRepo = new TagsRepo(db);
    this.graphRepo = new GraphNodesRepo(db);
    this.l3Repo = new L3NodesRepo(db);
    this.ftsRepo = new FtsRepo(db);
    this.metaRepo = new MetaRepo(db);
  }

  static async open(opts: GraphStoreOpenOptions): Promise<GraphStore> {
    try {
      fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });

      const db = opts.readonly
        ? new DatabaseConstructor(opts.dbPath, {
            readonly: true,
            fileMustExist: true,
          })
        : new DatabaseConstructor(opts.dbPath);

      // WAL pragmas (ADR-032): permit concurrent readers with a single writer.
      // busy_timeout is a connection-level runtime pragma and safe to set even on a readonly
      // connection; journal_mode/synchronous mutate the file and are skipped for readonly opens.
      db.pragma("busy_timeout = 10000");
      if (!opts.readonly) {
        db.pragma("journal_mode = WAL");
        db.pragma("synchronous = NORMAL");

        try {
          applyMigrations(db, MIGRATIONS_DIR);
        } catch (err) {
          throw new DocuviaError(
            ErrorCodes.DB_MIGRATION_FAILED,
            "Failed to apply migrations",
            err,
          );
        }
      }

      return new GraphStore(db);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_OPEN_FAILED,
        `Failed to open database at ${opts.dbPath}`,
        err,
      );
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  get projects(): ProjectsRepo {
    return this.projectsRepo;
  }

  get files(): ProjectFilesRepo {
    return this.filesRepo;
  }

  get tags(): TagsRepo {
    return this.tagsRepo;
  }

  get graph(): GraphNodesRepo {
    return this.graphRepo;
  }

  get l3(): L3NodesRepo {
    return this.l3Repo;
  }

  get fts(): FtsRepo {
    return this.ftsRepo;
  }

  get meta(): MetaRepo {
    return this.metaRepo;
  }

  /** Runs `fn` while holding the exclusive write lock (ADR-032) — serializes writers so parallel callers never race the single WAL writer slot. */
  async withWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.lock.runWrite(fn);
  }

  /** Runs `fn` while holding a shared read lock — may run alongside other readers, but never while a writer holds the exclusive lock. */
  async withReadLock<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.lock.runRead(fn);
  }

  /**
   * Surgically removes `project_files`/`l2_nodes` (and their `node_links`/`l2_node_l1_tags`) for
   * files no longer present in `activeFiles`, in a single transaction (see `IGraphStore`'s doc
   * comment). A node is stale when its `path_patterns` (a single-element JSON array — see
   * `GraphNodesRepo`'s doc comment) is missing, unparsable, or not in `activeFiles`.
   */
  pruneMissingFiles(activeFiles: string[]): {
    prunedFiles: number;
    prunedNodes: number;
  } {
    try {
      const activeSet = new Set(activeFiles);

      const staleNodeIds = (
        this.db.prepare("SELECT id, path_patterns FROM l2_nodes").all() as {
          id: number;
          path_patterns: string | null;
        }[]
      )
        .filter((row) => {
          let paths: string[];
          try {
            paths = row.path_patterns ? JSON.parse(row.path_patterns) : [];
          } catch {
            paths = [];
          }
          return paths.length === 0 || paths.every((p) => !activeSet.has(p));
        })
        .map((row) => row.id);

      const prune = this.db.transaction((ids: number[]) => {
        if (ids.length > 0) {
          const placeholders = ids.map(() => "?").join(",");
          this.db
            .prepare(
              `DELETE FROM l2_node_l1_tags WHERE l2_node_id IN (${placeholders})`,
            )
            .run(...ids);
          this.db
            .prepare(
              `DELETE FROM node_links WHERE source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders})`,
            )
            .run(...ids, ...ids);
          this.db
            .prepare(`DELETE FROM l2_nodes WHERE id IN (${placeholders})`)
            .run(...ids);
        }

        const allFiles = this.db
          .prepare("SELECT file_path FROM project_files")
          .all() as {
          file_path: string;
        }[];
        const staleFiles = allFiles.filter((f) => !activeSet.has(f.file_path));
        for (const { file_path } of staleFiles) {
          this.db
            .prepare("DELETE FROM project_files WHERE file_path = ?")
            .run(file_path);
        }
        return staleFiles.length;
      });

      const prunedFiles = prune(staleNodeIds);
      return { prunedFiles, prunedNodes: staleNodeIds.length };
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to prune missing files",
        err,
      );
    }
  }
}
