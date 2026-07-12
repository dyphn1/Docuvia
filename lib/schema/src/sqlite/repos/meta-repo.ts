import type Database from "better-sqlite3";
import { DocuviaError, ErrorCodes, type IMetaRepo } from "@workspace/contracts";

/** `docuvia_meta` repo — a small key/value store (STOR-002), currently used for the hydrated knowledge-branch tip sha. */
export class MetaRepo implements IMetaRepo {
  constructor(private readonly db: Database.Database) {}

  get(key: string): string | undefined {
    try {
      const row = this.db.prepare("SELECT value FROM docuvia_meta WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.DB_QUERY_FAILED, `Failed to read meta key "${key}"`, err);
    }
  }

  set(key: string, value: string): void {
    try {
      this.db
        .prepare(
          "INSERT INTO docuvia_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .run(key, value);
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.DB_QUERY_FAILED, `Failed to write meta key "${key}"`, err);
    }
  }
}
