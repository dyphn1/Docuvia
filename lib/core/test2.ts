import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { l2NodesTable } from "./lib/db/src/schema/l2_nodes.ts";

const sqlite = new Database(":memory:");
sqlite.exec(
  "CREATE TABLE l2_nodes (id SERIAL PRIMARY KEY, project_id INTEGER, name TEXT, type TEXT, is_system BOOLEAN, ai_generated BOOLEAN, needs_review BOOLEAN, reindex_required BOOLEAN, is_bootstrap_confirmed BOOLEAN);"
);
const db = drizzle(sqlite);
try {
  const result = db.select().from(l2NodesTable).all();
  console.log("Success:", result);
} catch (e) {
  console.log("Error:", e);
}
