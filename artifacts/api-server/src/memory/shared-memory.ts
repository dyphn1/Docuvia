import { createRequire } from "node:module";
import path from "path";
import fs from "fs";
import { logger } from "@workspace/core";

const require = createRequire(import.meta.url);
type SqliteRunResult = { changes: number };
type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
};

let _db: SqliteDb | null = null;

function getDb(): SqliteDb {
  if (!_db) {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (dbPath: string) => SqliteDb;
    };
    const DB_PATH = path.join(process.cwd(), "data", "shared_agent_memory.db");
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    _db = new DatabaseSync(DB_PATH);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS shared_agent_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_type TEXT NOT NULL,
          key TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS compressed_payloads (
          id TEXT PRIMARY KEY,
          original_text TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  return _db;
}

export function insertMemory(agentType: string, key: string, content: string) {
  const stmt = getDb().prepare(
    "INSERT INTO shared_agent_memory (agent_type, key, content) VALUES (?, ?, ?)"
  );
  return stmt.run(agentType, key, content);
}

export function getMemory(key: string) {
  const stmt = getDb().prepare("SELECT * FROM shared_agent_memory WHERE key = ?");
  return stmt.get(key) as any;
}

export function getAllMemories() {
  const stmt = getDb().prepare("SELECT * FROM shared_agent_memory ORDER BY timestamp DESC");
  return stmt.all() as any[];
}

export function saveCompressedPayload(id: string, originalText: string) {
  const stmt = getDb().prepare("INSERT INTO compressed_payloads (id, original_text) VALUES (?, ?)");
  return stmt.run(id, originalText);
}

export function getCompressedPayload(id: string) {
  const stmt = getDb().prepare("SELECT original_text FROM compressed_payloads WHERE id = ?");
  return stmt.get(id) as { original_text: string } | undefined;
}

export function purgeExpiredPayloads() {
  const stmt = getDb().prepare(
    "DELETE FROM compressed_payloads WHERE timestamp <= datetime('now', '-1 day')"
  );
  return stmt.run() as SqliteRunResult;
}

export function startTTLJob() {
  setInterval(
    () => {
      try {
        const info = purgeExpiredPayloads();
        if (info.changes > 0) {
          logger.info(`[SharedMemory] Purged ${info.changes} expired compressed payloads.`);
        }
      } catch (err) {
        logger.error(`[SharedMemory] Error purging expired payloads: ${err}`);
      }
    },
    60 * 60 * 1000
  ); // every hour
}

// Background job to mine failed API proxy responses
export function startMemoryMiner() {
  setInterval(() => {
    try {
      const db = getDb();
      const stmt = db.prepare("SELECT count(*) as total, datetime(timestamp, 'start of hour') as hour FROM compressed_payloads GROUP BY hour ORDER BY hour DESC LIMIT 24");
      const results = stmt.all() as { total: number, hour: string }[];
      
      const stats = {
        totalCompressedRecent: results.reduce((acc, row) => acc + row.total, 0),
        hourlyBreakdown: results
      };
      
      // Conditionally invoke insertMemory based on identified patterns
      if (stats.totalCompressedRecent > 50) {
        insertMemory("miner", "proxy_stats", JSON.stringify(stats));
        logger.info(`[SharedMemory] Mined proxy stats: ${stats.totalCompressedRecent} recent payloads, memory inserted.`);
      } else {
        logger.info(`[SharedMemory] Miner scanned ${stats.totalCompressedRecent} payloads, below threshold.`);
      }
    } catch (err) {
      logger.error(`[SharedMemory] Error in miner: ${err}`);
    }
  }, 60000); // every minute
}
