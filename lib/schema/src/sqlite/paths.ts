import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolved path to the migrations folder, independent of the current working directory of
 *  whatever process imports this package. */
export const MIGRATIONS_DIR = path.join(__dirname, "migrations");
