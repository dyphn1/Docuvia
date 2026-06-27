import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { l2NodesTable } from "@workspace/db/schema";

const sqlite = new Database(":memory:");
sqlite.exec("CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY, name TEXT);");
sqlite.exec('INSERT INTO l2_nodes (id, name) VALUES (1, "test");');

const db = drizzle(sqlite);
try {
  const result = db.select().from(l2NodesTable).get();
  console.log("Success:", result);
} catch (e) {
  console.log("Error:", e);
}
