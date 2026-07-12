import fs from "node:fs/promises";
import DatabaseConstructor from "better-sqlite3";
import {
  DiagnosticStatus,
  type DiagnosticResult,
  type IDiagnosticRunner,
} from "@workspace/contracts";

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
      results["sqlite_connection"] = {
        status: DiagnosticStatus.FAIL,
        message: "Failed to open SQLite database",
        details: String(err),
        suggestion:
          "Ensure you have read/write permissions for the .docuvia directory, or try running 'docuvia init' again.",
      };
      return results;
    }

    try {
      const integrity = db.pragma("integrity_check", { simple: true });
      if (
        integrity === "ok" ||
        (Array.isArray(integrity) && integrity[0]?.integrity_check === "ok")
      ) {
        results["sqlite_integrity"] = {
          status: DiagnosticStatus.PASS,
          message: "Database integrity check passed",
        };
      } else {
        results["sqlite_integrity"] = {
          status: DiagnosticStatus.FAIL,
          message: "Database integrity check failed",
          details: JSON.stringify(integrity),
          suggestion:
            "The database file might be corrupted. Consider running 'docuvia clean' and 'docuvia hydrate' to rebuild it.",
        };
      }
    } catch (err) {
      results["sqlite_integrity"] = {
        status: DiagnosticStatus.FAIL,
        message: "Error running integrity check",
        details: String(err),
        suggestion:
          "The database file might be corrupted. Consider running 'docuvia clean' and 'docuvia hydrate' to rebuild it.",
      };
    }

    try {
      const walPath = dbPath + "-wal";
      const stats = await fs.stat(walPath).catch(() => null);
      if (stats && stats.size > 100 * 1024 * 1024) {
        // 100MB
        results["sqlite_wal_bloat"] = {
          status: DiagnosticStatus.FAIL,
          message: "WAL file is too large (>100MB)",
          details: `Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
          suggestion:
            "SQLite Write-Ahead Log has bloated. You can run 'docuvia clean' and re-initialize, or restart the agent to force a checkpoint.",
        };
      } else {
        results["sqlite_wal_bloat"] = {
          status: DiagnosticStatus.PASS,
          message: "WAL file size is normal",
        };
      }
    } catch (err) {
      // ignore
    }

    db.close();
    return results;
  }
}
