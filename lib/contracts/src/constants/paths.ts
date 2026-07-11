/**
 * Workspace-layout conventions shared across every layer (Presentation resolves paths from
 * these, `lib/ui-core` writes run logs against them, `lib/core`'s command-log-writer — wait,
 * see `lib/ui-core/src/utils/command-log-writer.ts` — reads them too). Zero logic, just the
 * shared naming convention every layer must agree on, per design-spirit.md's "Centralized
 * Constants" rule.
 */

/** Name of the hidden directory holding all local Docuvia state (SQLite db, temp files, run logs). */
export const DOCUVIA_DIR_NAME = ".docuvia";

/** Directory (relative to `DOCUVIA_DIR_NAME`) holding persisted, AI-inspectable run logs. */
export const DOCUVIA_LOGS_DIR_NAME = "logs";

export const INIT_LOG_FILE_NAME = "init.log";

/** Filename (relative to `DOCUVIA_DIR_NAME`) of the local SQLite database. */
export const LOCAL_DB_FILE_NAME = "local.db";
