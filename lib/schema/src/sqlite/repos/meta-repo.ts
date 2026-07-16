import type Database from "better-sqlite3";
import { DocuviaError, ErrorCodes, type IMetaRepo } from "@workspace/contracts";
import { SchemaTables } from "../constants.js";

const META_REPO_ERROR_MESSAGES = {
  READ_FAILED: (key: string) => `Failed to read meta key "${key}"`,
  WRITE_FAILED: (key: string) => `Failed to write meta key "${key}"`,
} as const;

/** `docuvia_meta` repo — a small key/value store (STOR-002), currently used for the hydrated knowledge-branch tip sha. */
export class MetaRepo implements IMetaRepo {
  constructor(private readonly db: Database.Database) {}

  get(key: string): string | undefined {
    try {
      const row = this.db
        .prepare(`SELECT value FROM ${SchemaTables.DOCUVIA_META} WHERE key = ?`)
        .get(key) as { value: string } | undefined;
      return row?.value;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        META_REPO_ERROR_MESSAGES.READ_FAILED(key),
        err,
      );
    }
  }

  set(key: string, value: string): void {
    try {
      this.db
        .prepare(
          `INSERT INTO ${SchemaTables.DOCUVIA_META} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(key, value);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        META_REPO_ERROR_MESSAGES.WRITE_FAILED(key),
        err,
      );
    }
  }
}
