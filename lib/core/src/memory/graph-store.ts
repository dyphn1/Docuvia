import fs from "node:fs";
import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import { applyMigrations, MIGRATIONS_DIR } from "@workspace/schema";
import { ReadWriteLock } from "../utils/read-write-lock.js";
import { ProjectsRepo } from "./repos/projects-repo.js";
import { ProjectFilesRepo } from "./repos/files-repo.js";
import { TagsRepo } from "./repos/tags-repo.js";
import { GraphNodesRepo } from "./repos/graph-repo.js";
import { FtsRepo } from "./repos/fts-repo.js";

export interface GraphStoreOpenOptions {
  /** Path to the local.db SQLite file (e.g. `<workspaceRoot>/.docuvia/local.db`). */
  dbPath: string;
  /** Opens the connection read-only; skips WAL pragma writes and migrations. */
  readonly?: boolean;
}

/**
 * The shared memory/state layer (see the plan's "The memory/state layer"
 * section). Replaces old Docuvia's pattern of 9+ independent files each
 * opening their own `better-sqlite3` connection to the same file.
 *
 * One `GraphStore` per `dbPath` per process, opened once by a composition
 * root and passed down to every service that needs data access. Lifecycle
 * (`close()`) is owned by the composition root only — no service closes it.
 */
export class GraphStore {
  private readonly lock = new ReadWriteLock();
  private readonly projectsRepo: ProjectsRepo;
  private readonly filesRepo: ProjectFilesRepo;
  private readonly tagsRepo: TagsRepo;
  private readonly graphRepo: GraphNodesRepo;
  private readonly ftsRepo: FtsRepo;

  private constructor(private readonly db: Database.Database) {
    this.projectsRepo = new ProjectsRepo(db);
    this.filesRepo = new ProjectFilesRepo(db);
    this.tagsRepo = new TagsRepo(db);
    this.graphRepo = new GraphNodesRepo(db);
    this.ftsRepo = new FtsRepo(db);
  }

  static async open(opts: GraphStoreOpenOptions): Promise<GraphStore> {
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });

    const db = opts.readonly
      ? new DatabaseConstructor(opts.dbPath, { readonly: true, fileMustExist: true })
      : new DatabaseConstructor(opts.dbPath);

    // WAL pragmas (ADR-032): permit concurrent readers with a single writer,
    // matching old Docuvia's SqliteGraphRepository.persistAstGraphUnlocked.
    // busy_timeout is a connection-level runtime pragma and safe to set even
    // on a readonly connection; journal_mode/synchronous mutate the file and
    // are skipped for readonly opens.
    db.pragma("busy_timeout = 10000");
    if (!opts.readonly) {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");

      // Migration-running lives here (not inside InitService) so every
      // command that opens a store gets schema-safety for free, not just
      // `init`.
      applyMigrations(db, MIGRATIONS_DIR);
    }

    return new GraphStore(db);
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

  get fts(): FtsRepo {
    return this.ftsRepo;
  }

  /** Runs `fn` while holding the exclusive write lock (ADR-032) — serializes writers so parallel callers never race the single WAL writer slot. */
  async withWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.lock.runWrite(fn);
  }

  /** Runs `fn` while holding a shared read lock — may run alongside other readers, but never while a writer holds the exclusive lock. */
  async withReadLock<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.lock.runRead(fn);
  }
}
