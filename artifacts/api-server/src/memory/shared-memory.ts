import { SHARED_AGENT_MEMORY_DB_NAME } from "@workspace/core";
import { createRequire } from "node:module";
import path from "path";
import fs from "fs";
import { logger } from "@workspace/core";
import { SHARED_MEMORY_DEFAULTS } from "../constants/index.js";

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
    const DB_PATH = path.join(
      process.cwd(),
      SHARED_MEMORY_DEFAULTS.DATA_DIR_NAME,
      SHARED_AGENT_MEMORY_DB_NAME
    );
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    _db = new DatabaseSync(DB_PATH);
    _db.exec(SHARED_MEMORY_DEFAULTS.SQL_INIT_SCHEMA);
  }
  return _db;
}

export function insertMemory(agentType: string, key: string, content: string) {
  const stmt = getDb().prepare(SHARED_MEMORY_DEFAULTS.SQL_INSERT_MEMORY);
  return stmt.run(agentType, key, content);
}

export function getMemory(key: string) {
  const stmt = getDb().prepare(SHARED_MEMORY_DEFAULTS.SQL_SELECT_QUARANTINE_STMT);
  return stmt.get(key) as any;
}

export function getAllMemories() {
  const stmt = getDb().prepare(SHARED_MEMORY_DEFAULTS.SQL_SELECT_ALL_MEMORIES);
  return stmt.all() as any[];
}

export function saveCompressedPayload(id: string, originalText: string) {
  const stmt = getDb().prepare(SHARED_MEMORY_DEFAULTS.SQL_INSERT_COMPRESSED_PAYLOAD);
  return stmt.run(id, originalText);
}

export function getCompressedPayload(id: string) {
  const stmt = getDb().prepare(SHARED_MEMORY_DEFAULTS.SQL_SELECT_COMPRESSED_PAYLOAD);
  return stmt.get(id) as { original_text: string } | undefined;
}

export function purgeExpiredPayloads() {
  const stmt = getDb().prepare(SHARED_MEMORY_DEFAULTS.SQL_DELETE_EXPIRED_PAYLOADS);
  return stmt.run() as SqliteRunResult;
}

export function startTTLJob() {
  setInterval(() => {
    try {
      const info = purgeExpiredPayloads();
      if (info.changes > 0) {
        logger.info(`[SharedMemory] Purged ${info.changes} expired compressed payloads.`);
      }
    } catch (err) {
      logger.error(`[SharedMemory] Error purging expired payloads: ${err}`);
    }
  }, SHARED_MEMORY_DEFAULTS.TTL_JOB_INTERVAL_MS); // every hour
}

// Background job to mine failed API proxy responses
export function startMemoryMiner() {
  setInterval(() => {
    try {
      const db = getDb();
      const stmt = db.prepare(SHARED_MEMORY_DEFAULTS.SQL_MINE_PROXY_STATS);
      const results = stmt.all() as { total: number; hour: string }[];

      const stats = {
        totalCompressedRecent: results.reduce((acc, row) => acc + row.total, 0),
        hourlyBreakdown: results,
      };

      // Conditionally invoke insertMemory based on identified patterns
      if (stats.totalCompressedRecent > SHARED_MEMORY_DEFAULTS.MINER_TRIGGER_THRESHOLD) {
        insertMemory(
          SHARED_MEMORY_DEFAULTS.MINER_AGENT_TYPE,
          SHARED_MEMORY_DEFAULTS.MINER_PROXY_STATS_KEY,
          JSON.stringify(stats)
        );
        logger.info(
          `[SharedMemory] Mined proxy stats: ${stats.totalCompressedRecent} recent payloads, memory inserted.`
        );
      } else {
        logger.info(
          `[SharedMemory] Miner scanned ${stats.totalCompressedRecent} payloads, below threshold.`
        );
      }
    } catch (err) {
      logger.error(`[SharedMemory] Error in miner: ${err}`);
    }
  }, SHARED_MEMORY_DEFAULTS.MINER_JOB_INTERVAL_MS); // every minute
}
