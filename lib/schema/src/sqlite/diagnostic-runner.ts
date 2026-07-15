import fs from "node:fs/promises";
import DatabaseConstructor from "better-sqlite3";
import {
  DiagnosticStatus,
  type DiagnosticResult,
  type IDiagnosticRunner,
} from "@workspace/contracts";
import { SQLiteConstants } from "./constants.js";

/** Keys of the `Record<string, DiagnosticResult>` this runner reports — `docuvia doctor`'s check ids for the SQLite technology provider. */
const DiagnosticCheckIds = {
  CONNECTION: "sqlite_connection",
  INTEGRITY: "sqlite_integrity",
  WAL_BLOAT: "sqlite_wal_bloat",
} as const;

/** SQLite's own `PRAGMA integrity_check` success value — external pragma vocabulary, not project-defined. */
const INTEGRITY_CHECK_OK = "ok" as const;

const DIAGNOSTIC_MESSAGES = {
  CONNECTION_FAILED: "Failed to open SQLite database",
  CONNECTION_SUGGESTION:
    "Ensure you have read/write permissions for the .docuvia directory, or try running 'docuvia init' again.",
  INTEGRITY_PASSED: "Database integrity check passed",
  INTEGRITY_FAILED: "Database integrity check failed",
  INTEGRITY_CHECK_ERRORED: "Error running integrity check",
  CORRUPTION_SUGGESTION:
    "The database file might be corrupted. Consider running 'docuvia clean' and 'docuvia hydrate' to rebuild it.",
  WAL_TOO_LARGE: "WAL file is too large (>100MB)",
  WAL_SIZE_DETAILS: (sizeMb: string) => `Size: ${sizeMb} MB`,
  WAL_BLOAT_SUGGESTION:
    "SQLite Write-Ahead Log has bloated. You can run 'docuvia clean' and re-initialize, or restart the agent to force a checkpoint.",
  WAL_SIZE_NORMAL: "WAL file size is normal",
} as const;

const WAL_BLOAT_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100MB

export class SqliteDiagnosticRunner implements IDiagnosticRunner {
  async checkHealth(dbPath: string): Promise<Record<string, DiagnosticResult>> {
    const results: Record<string, DiagnosticResult> = {};

    let db;
    try {
      db = new DatabaseConstructor(dbPath, {
        readonly: true,
        fileMustExist: true,
      });
    } catch (err) {
      results[DiagnosticCheckIds.CONNECTION] = {
        status: DiagnosticStatus.FAIL,
        message: DIAGNOSTIC_MESSAGES.CONNECTION_FAILED,
        details: String(err),
        suggestion: DIAGNOSTIC_MESSAGES.CONNECTION_SUGGESTION,
      };
      return results;
    }

    try {
      const integrity = db.pragma("integrity_check", { simple: true });
      if (
        integrity === INTEGRITY_CHECK_OK ||
        (Array.isArray(integrity) &&
          integrity[0]?.integrity_check === INTEGRITY_CHECK_OK)
      ) {
        results[DiagnosticCheckIds.INTEGRITY] = {
          status: DiagnosticStatus.PASS,
          message: DIAGNOSTIC_MESSAGES.INTEGRITY_PASSED,
        };
      } else {
        results[DiagnosticCheckIds.INTEGRITY] = {
          status: DiagnosticStatus.FAIL,
          message: DIAGNOSTIC_MESSAGES.INTEGRITY_FAILED,
          details: JSON.stringify(integrity),
          suggestion: DIAGNOSTIC_MESSAGES.CORRUPTION_SUGGESTION,
        };
      }
    } catch (err) {
      results[DiagnosticCheckIds.INTEGRITY] = {
        status: DiagnosticStatus.FAIL,
        message: DIAGNOSTIC_MESSAGES.INTEGRITY_CHECK_ERRORED,
        details: String(err),
        suggestion: DIAGNOSTIC_MESSAGES.CORRUPTION_SUGGESTION,
      };
    }

    try {
      const walPath = dbPath + SQLiteConstants.WAL_FILE_SUFFIX;
      const stats = await fs.stat(walPath).catch(() => null);
      if (stats && stats.size > WAL_BLOAT_THRESHOLD_BYTES) {
        results[DiagnosticCheckIds.WAL_BLOAT] = {
          status: DiagnosticStatus.FAIL,
          message: DIAGNOSTIC_MESSAGES.WAL_TOO_LARGE,
          details: DIAGNOSTIC_MESSAGES.WAL_SIZE_DETAILS(
            (stats.size / 1024 / 1024).toFixed(2),
          ),
          suggestion: DIAGNOSTIC_MESSAGES.WAL_BLOAT_SUGGESTION,
        };
      } else {
        results[DiagnosticCheckIds.WAL_BLOAT] = {
          status: DiagnosticStatus.PASS,
          message: DIAGNOSTIC_MESSAGES.WAL_SIZE_NORMAL,
        };
      }
    } catch (err) {
      // ignore
    }

    db.close();
    return results;
  }
}
