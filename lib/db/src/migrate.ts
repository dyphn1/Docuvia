import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { promptTemplatesTable } from "./schema/prompt-templates";
import { isNull } from "drizzle-orm";

export const DEFAULT_PROMPT_TEMPLATES = [
  {
    templateType: "l1_tagger",
    systemPrompt:
      "You are an expert system tagger. Categorize the given code into high-level architecture tags.",
    isActive: true,
  },
  {
    templateType: "l2_extractor",
    systemPrompt:
      "You are an expert code analyst. Extract L2 module boundaries from the following commits.",
    isActive: true,
  },
  {
    templateType: "l3_generator",
    systemPrompt:
      "You are a senior architect. Generate L3 knowledge graph nodes documenting the decisions made in the following code.",
    isActive: true,
  },
] as const;

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
    // Only seed if global templates (projectId IS NULL) do not exist.
    const existing = await db
      .select()
      .from(promptTemplatesTable)
      .where(isNull(promptTemplatesTable.projectId))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(promptTemplatesTable).values(
        DEFAULT_PROMPT_TEMPLATES.map((t) => ({
          templateType: t.templateType as any,
          systemPrompt: t.systemPrompt,
          isActive: t.isActive,
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
