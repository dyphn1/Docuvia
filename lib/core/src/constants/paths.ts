/**
 * Path/size-related constants for the local-SQLite-backed pilot surface.
 *
 * This is deliberately a narrower subset of old Docuvia's
 * `constants/paths.ts` (which also carried a bunch of Postgres/server-facing
 * log-file-name and default-server-URL constants not implicated in the
 * `init` pilot) — only what `FileDiscoveryService`/`init` actually need
 * today. Port the rest of the old file in when a later command needs it.
 */

/** Name of the hidden directory holding all local Docuvia state (SQLite db, temp files, exports). */
export const DOCUVIA_DIR_NAME = ".docuvia";

/** Directory (relative to `DOCUVIA_DIR_NAME`) holding persisted, AI-inspectable run logs. */
export const DOCUVIA_LOGS_DIR_NAME = "logs";
export const INIT_LOG_FILE_NAME = "init.log";

/**
 * Files at/above this size are skipped during discovery rather than fully read and
 * handed to a parse worker. Matches GitNexus's documented oversized-file threshold,
 * so file-count comparisons between the two tools are apples-to-apples.
 */
export const MAX_FILE_SIZE_BYTES = 512_000;
