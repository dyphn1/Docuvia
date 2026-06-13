import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { promptTemplatesTable, DEFAULT_PROMPT_TEMPLATES } from "./schema/prompt_templates";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set.");
  }
  const migrationClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);

  const LOCK_ID = 7274813; // PostgreSQL Advisory Lock for migrations
  await migrationClient`SELECT pg_advisory_lock(${LOCK_ID})`;
  console.log("Acquired migration advisory lock.");

  try {
    console.log("Running migrations...");
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    
    await migrate(db, { migrationsFolder });
    
    console.log("Migrations completed!");

    console.log("Seeding default prompt templates...");
    // Using onConflictDoNothing assumes there is a unique constraint. Since there isn't one on templateType + projectId IS NULL out of the box,
    // we can do a simple check.
    const existing = await db.select().from(promptTemplatesTable).limit(1);
    if (existing.length === 0) {
      await db.insert(promptTemplatesTable).values(
        DEFAULT_PROMPT_TEMPLATES.map(t => ({
          templateType: t.templateType as any,
          systemPrompt: t.systemPrompt,
          isActive: t.isActive
        }))
      );
      console.log("Default templates seeded!");
    } else {
      console.log("Templates already exist, skipping seed.");
    }
  } finally {
    await migrationClient`SELECT pg_advisory_unlock(${LOCK_ID})`;
    console.log("Released migration advisory lock.");
    await migrationClient.end();
  }
}

runMigrations().catch((err) => {
  console.error("Migration failed", err);
  process.exit(1);
});