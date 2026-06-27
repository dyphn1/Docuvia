import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { pgTable, text, serial } from "drizzle-orm/pg-core";

const l2NodesTable = pgTable("l2_nodes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

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
