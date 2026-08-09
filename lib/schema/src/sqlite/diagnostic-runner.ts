import fs from "node:fs/promises";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import {
  DiagnosticStatus,
  type DiagnosticResult,
  type IDiagnosticRunner,
} from "@workspace/contracts";
import { SQLiteConstants, SqlitePragmaNames } from "./constants.js";

/** Keys of the `Record<string, DiagnosticResult>` this runner reports — `docuvia doctor`'s check ids for the SQLite technology provider. */
const DiagnosticCheckIds = {
  CONNECTION: "sqlite_connection",
  INTEGRITY: "sqlite_integrity",
  WAL_BLOAT: "sqlite_wal_bloat",
  ABI_MISMATCH: "sqlite_abi_mismatch",
} as const;

/** Substring better-sqlite3's native-loader failure carries when the `.node` binding was built for
 *  a different Node.js ABI than the running one (a NODE_MODULE_VERSION drift). External vocabulary,
 *  matched defensively -- an absent match simply means "not an ABI problem", and every other open
 *  failure still falls through to the generic `sqlite_connection` check. */
const ABI_MISMATCH_MARKER = "NODE_MODULE_VERSION" as const;

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
  ABI_MISMATCH:
    "The better-sqlite3 native module was compiled for a different Node.js version than the one running this command (NODE_MODULE_VERSION drift).",
  ABI_MISMATCH_SUGGESTION:
    "Run `pnpm install --force` (or `pnpm rebuild better-sqlite3`) using the SAME Node.js version the CLI will resolve at runtime, or switch to a single pinned Node.js version (e.g. via nvm) so the native binding is rebuilt against the version you actually use.",
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
      this.failConnection(results, String(err));
      return results;
    }

    await this.runHealthChecks(db, dbPath, results);

    db.close();
    return results;
  }

  /** Populates the connection (and, on a native-ABI drift, the dedicated `sqlite_abi_mismatch`)
   *  FAIL diagnostics when the database can't be opened. */
  private failConnection(
    results: Record<string, DiagnosticResult>,
    message: string,
  ): void {
    // 2026-08 dogfooding finding: a native-ABI drift (better-sqlite3 built for a different Node.js
    // than the one on PATH) renders every DB-bound command "database not found" -- distinguish it
    // here so `doctor` points at the real fix (`pnpm rebuild` on ONE Node) rather than at
    // permissions/`init`, which never resolve it.
    const isAbiMismatch = message.includes(ABI_MISMATCH_MARKER);
    if (isAbiMismatch) {
      results[DiagnosticCheckIds.ABI_MISMATCH] = {
        status: DiagnosticStatus.FAIL,
        message: DIAGNOSTIC_MESSAGES.ABI_MISMATCH,
        details: message,
        suggestion: DIAGNOSTIC_MESSAGES.ABI_MISMATCH_SUGGESTION,
      };
    }
    results[DiagnosticCheckIds.CONNECTION] = {
      status: DiagnosticStatus.FAIL,
      message: DIAGNOSTIC_MESSAGES.CONNECTION_FAILED,
      details: message,
      suggestion: isAbiMismatch
        ? DIAGNOSTIC_MESSAGES.ABI_MISMATCH_SUGGESTION
        : DIAGNOSTIC_MESSAGES.CONNECTION_SUGGESTION,
    };
  }

  /** Runs the post-open health checks (integrity + WAL bloat) against a live connection. */
  private async runHealthChecks(
    db: Database.Database,
    dbPath: string,
    results: Record<string, DiagnosticResult>,
  ): Promise<void> {
    try {
      const integrity = db.pragma(SqlitePragmaNames.INTEGRITY_CHECK, {
        simple: true,
      });
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
  }
}
