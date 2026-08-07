import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import type { GraphStoreOpenOptions, IGraphStore } from "@workspace/contracts";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { applyMigrations } from "./migration-runner.js";
import { MIGRATIONS_DIR } from "./paths.js";
import {
  SQLiteConstants,
  SqlitePragmaNames,
  SchemaTables,
  SchemaColumns,
} from "./constants.js";
import { ReadWriteLock } from "./read-write-lock.js";
import { ProjectsRepo } from "./repos/projects-repo.js";
import { ProjectFilesRepo } from "./repos/files-repo.js";
import { TagsRepo } from "./repos/tags-repo.js";
import { GraphNodesRepo } from "./repos/graph-repo.js";
import { L3NodesRepo } from "./repos/l3-nodes-repo.js";
import { FtsRepo } from "./repos/fts-repo.js";
import { MetaRepo } from "./repos/meta-repo.js";
import { CallSitesRepo } from "./repos/call-sites-repo.js";

const INIT_LOCK_MAX_WAIT_MS = 10_000;
const INIT_LOCK_RETRY_INTERVAL_MS = 100;
const INIT_LOCK_STALE_MS = 60_000;
/** Suffix appended to `dbPath` for the cross-process init-bootstrap lock file (see `acquireInitLock`). */
const INIT_LOCK_FILE_SUFFIX = ".init-lock" as const;
/** Node.js `fs.open` flag: fail (`EEXIST`) instead of overwriting if the path already exists — the basis of `acquireInitLock`'s exclusive-create lock (same shape as `lib/contracts`'s `process-lock.ts`). */
const FS_FLAG_EXCLUSIVE_CREATE_WRITE = "wx" as const;
/** `NodeJS.ErrnoException.code` reported by `fs.open(path, "wx")` when `path` already exists. */
const ERRNO_EEXIST = "EEXIST" as const;

const GRAPH_STORE_ERROR_MESSAGES = {
  INIT_LOCK_ACQUIRE_FAILED: "Failed to acquire database init lock",
  INIT_LOCK_TIMED_OUT: (lockPath: string) =>
    `Timed out waiting for the database init lock at ${lockPath} — another Docuvia process may be stuck`,
  OPEN_FAILED: (dbPath: string) => `Failed to open database at ${dbPath}`,
  MIGRATIONS_FAILED: "Failed to apply migrations",
  PRUNE_MISSING_FILES_FAILED: "Failed to prune missing files",
} as const;

/**
 * Cross-process mutex around a fresh database's first bootstrap (WAL-mode switch + migrations)
 * — same shape as git-local-provider.ts's `acquireKnowledgeLock`/`releaseKnowledgeLock`. Needed
 * because two `docuvia init` processes racing the same workspace both reach `GraphStore.open()`
 * before either has finished bootstrapping: SQLite's own `busy_timeout` only smooths out
 * SQLITE_BUSY on individual statements, not the "switch journal_mode to WAL" + "apply pending
 * migrations" sequence as a whole, so without this lock the loser can still see a raw
 * `SqliteError: database is locked` or a `schema_migrations` UNIQUE violation.
 */
async function acquireInitLock(dbPath: string): Promise<string> {
  const lockPath = `${dbPath}${INIT_LOCK_FILE_SUFFIX}`;
  const deadline = Date.now() + INIT_LOCK_MAX_WAIT_MS;

  for (;;) {
    try {
      const handle = await fsPromises.open(
        lockPath,
        FS_FLAG_EXCLUSIVE_CREATE_WRITE,
      );
      await handle.close();
      return lockPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== ERRNO_EEXIST) {
        throw DocuviaError.wrap(
          ErrorCodes.DB_LOCKED,
          GRAPH_STORE_ERROR_MESSAGES.INIT_LOCK_ACQUIRE_FAILED,
          err,
        );
      }

      const stat = await fsPromises.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > INIT_LOCK_STALE_MS) {
        await fsPromises.rm(lockPath, { force: true });
        continue;
      }

      if (Date.now() > deadline) {
        throw new DocuviaError(
          ErrorCodes.DB_LOCKED,
          GRAPH_STORE_ERROR_MESSAGES.INIT_LOCK_TIMED_OUT(lockPath),
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, INIT_LOCK_RETRY_INTERVAL_MS),
      );
    }
  }
}

async function releaseInitLock(lockPath: string): Promise<void> {
  await fsPromises.rm(lockPath, { force: true });
}

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
  private readonly callSitesRepo: CallSitesRepo;

  private constructor(private readonly db: Database.Database) {
    this.projectsRepo = new ProjectsRepo(db);
    this.filesRepo = new ProjectFilesRepo(db);
    this.tagsRepo = new TagsRepo(db);
    this.graphRepo = new GraphNodesRepo(db);
    this.l3Repo = new L3NodesRepo(db);
    this.ftsRepo = new FtsRepo(db);
    this.metaRepo = new MetaRepo(db);
    this.callSitesRepo = new CallSitesRepo(db);
  }

  static async open(opts: GraphStoreOpenOptions): Promise<GraphStore> {
    // Only writers bootstrap (switch journal mode, apply migrations) — that sequence isn't safe
    // against a second process doing the same thing at the same time (see acquireInitLock's
    // comment), so serialize it with a cross-process lock. Readonly opens never touch the file
    // and don't need it. The lock file lives next to dbPath, so its directory must exist first.
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });

    const lockPath = opts.readonly
      ? undefined
      : await acquireInitLock(opts.dbPath).catch((err) => {
          throw DocuviaError.wrap(
            ErrorCodes.DB_OPEN_FAILED,
            GRAPH_STORE_ERROR_MESSAGES.OPEN_FAILED(opts.dbPath),
            err,
          );
        });

    try {
      const db = opts.readonly
        ? new DatabaseConstructor(opts.dbPath, {
            readonly: true,
            fileMustExist: true,
          })
        : new DatabaseConstructor(opts.dbPath);

      // WAL pragmas (ADR-032): permit concurrent readers with a single writer.
      // busy_timeout is a connection-level runtime pragma and safe to set even on a readonly
      // connection; journal_mode/synchronous mutate the file and are skipped for readonly opens.
      db.pragma(
        `${SqlitePragmaNames.BUSY_TIMEOUT} = ${SQLiteConstants.BUSY_TIMEOUT_MS}`,
      );
      if (!opts.readonly) {
        db.pragma(
          `${SqlitePragmaNames.JOURNAL_MODE} = ${SQLiteConstants.JOURNAL_MODE}`,
        );
        db.pragma(
          `${SqlitePragmaNames.SYNCHRONOUS} = ${SQLiteConstants.SYNCHRONOUS}`,
        );

        try {
          applyMigrations(db, MIGRATIONS_DIR);
        } catch (err) {
          throw new DocuviaError(
            ErrorCodes.DB_MIGRATION_FAILED,
            GRAPH_STORE_ERROR_MESSAGES.MIGRATIONS_FAILED,
            err,
          );
        }
      }

      return new GraphStore(db);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_OPEN_FAILED,
        GRAPH_STORE_ERROR_MESSAGES.OPEN_FAILED(opts.dbPath),
        err,
      );
    } finally {
      if (lockPath) await releaseInitLock(lockPath);
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

  get callSites(): CallSitesRepo {
    return this.callSitesRepo;
  }

  /** Runs `fn` while holding the exclusive write lock (ADR-032) — serializes writers so parallel callers never race the single WAL writer slot. */
  async withWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.lock.runWrite(fn);
  }

  /** Runs `fn` while holding a shared read lock — may run alongside other readers, but never while a writer holds the exclusive lock. */
  async withReadLock<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.lock.runRead(fn);
  }

  /** See `IGraphStore.withTransaction`'s doc comment. `better-sqlite3`'s `db.transaction(fn)`
   *  returns a wrapped function that runs `fn` inside BEGIN/COMMIT (ROLLBACK on throw) — call it
   *  immediately rather than handing the wrapper back to the caller. */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
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
        this.db
          .prepare(
            `SELECT id, ${SchemaColumns.PATH_PATTERNS} FROM ${SchemaTables.L2_NODES}`,
          )
          .all() as {
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
              `DELETE FROM ${SchemaTables.L2_NODE_L1_TAGS} WHERE ${SchemaColumns.L2_NODE_ID} IN (${placeholders})`,
            )
            .run(...ids);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.NODE_LINKS} WHERE ${SchemaColumns.SOURCE_NODE_ID} IN (${placeholders}) OR ${SchemaColumns.TARGET_NODE_ID} IN (${placeholders})`,
            )
            .run(...ids, ...ids);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.L2_NODES} WHERE id IN (${placeholders})`,
            )
            .run(...ids);
        }

        const allFiles = this.db
          .prepare(
            `SELECT ${SchemaColumns.FILE_PATH} FROM ${SchemaTables.PROJECT_FILES}`,
          )
          .all() as {
          file_path: string;
        }[];
        const staleFiles = allFiles.filter((f) => !activeSet.has(f.file_path));
        for (const { file_path } of staleFiles) {
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.PROJECT_FILES} WHERE ${SchemaColumns.FILE_PATH} = ?`,
            )
            .run(file_path);
        }
        return staleFiles.length;
      });

      const prunedFiles = prune(staleNodeIds);
      return { prunedFiles, prunedNodes: staleNodeIds.length };
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_STORE_ERROR_MESSAGES.PRUNE_MISSING_FILES_FAILED,
        err,
      );
    }
  }
}
