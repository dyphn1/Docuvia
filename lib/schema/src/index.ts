import { fileURLToPath } from "node:url";
import path from "node:path";

export { applyMigrations } from "./sqlite/migration-runner.js";
export type {
  ProjectRow,
  ProjectFileRow,
  L1TagRow,
  L2NodeRow,
  NodeLinkRow,
  L2NodeL1TagRow,
  L3NodeRow,
} from "./sqlite/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolved path to the migrations folder, independent of the current
 * working directory of whatever process imports this package (consumers in
 * `lib/core`'s `GraphStore.open()` point at this rather than a hardcoded
 * relative path).
 */
export const MIGRATIONS_DIR = path.join(__dirname, "sqlite", "migrations");
