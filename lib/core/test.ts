import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { l2NodesTable } from "@workspace/db/schema";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite);
try {
  db.select().from(l2NodesTable).get();
  console.log("Success");
} catch (e) {
  console.log("Error:", e);
}
