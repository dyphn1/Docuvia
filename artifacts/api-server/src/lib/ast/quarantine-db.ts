import { AST_QUARANTINE_DB_NAME } from "@workspace/core";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { AST_INGESTION_DEFAULTS } from "../../constants/index.js";

const DB_PATH = path.join(
  process.cwd(),
  AST_INGESTION_DEFAULTS.DATA_DIR_NAME,
  AST_QUARANTINE_DB_NAME
);

// Ensure directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(AST_INGESTION_DEFAULTS.SQL_CREATE_TABLE);

export function isQuarantined(filePath: string): boolean {
  const stmt = db.prepare(AST_INGESTION_DEFAULTS.SQL_SELECT_QUARANTINE);
  return !!stmt.get(filePath);
}

export function quarantineFile(filePath: string): void {
  const stmt = db.prepare(AST_INGESTION_DEFAULTS.SQL_INSERT_QUARANTINE);
  stmt.run(filePath);
}
