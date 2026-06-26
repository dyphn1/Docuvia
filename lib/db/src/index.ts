import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Enable pgvector extension on pool creation
pool.on("connect", async (client) => {
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
});

const baseDb = drizzle(pool, { schema });
export type DbClient = typeof baseDb;

const transactionStore = new AsyncLocalStorage<DbClient>();

export const db = new Proxy(baseDb, {
  get(target, prop, receiver) {
    const activeDb = transactionStore.getStore() ?? target;
    const value = Reflect.get(activeDb, prop, receiver);
    return typeof value === "function" ? value.bind(activeDb) : value;
  },
}) as DbClient;

class RollbackSignal<T> extends Error {
  constructor(readonly value: T) {
    super("Rollback test transaction");
  }
}

export async function runInRollbackTransaction<T>(
  callback: (tx: DbClient) => Promise<T> | T
): Promise<T> {
  try {
    await baseDb.transaction(async (tx) => {
      const value = await transactionStore.run(tx as unknown as DbClient, () =>
        callback(tx as unknown as DbClient)
      );
      throw new RollbackSignal(value);
    });
  } catch (error) {
    if (error instanceof RollbackSignal) {
      return error.value;
    }
    throw error;
  }

  throw new Error("Rollback transaction completed unexpectedly");
}

export * from "./schema";
