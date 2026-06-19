import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { logger } from '../lib/logger.js';

const DB_PATH = path.join(process.cwd(), 'data', 'shared_agent_memory.db');

// Ensure directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
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

export function insertMemory(agentType: string, key: string, content: string) {
    const stmt = db.prepare('INSERT INTO shared_agent_memory (agent_type, key, content) VALUES (?, ?, ?)');
    return stmt.run(agentType, key, content);
}

export function getMemory(key: string) {
    const stmt = db.prepare('SELECT * FROM shared_agent_memory WHERE key = ?');
    return stmt.get(key) as any;
}

export function getAllMemories() {
    const stmt = db.prepare('SELECT * FROM shared_agent_memory ORDER BY timestamp DESC');
    return stmt.all() as any[];
}

export function saveCompressedPayload(id: string, originalText: string) {
    const stmt = db.prepare('INSERT INTO compressed_payloads (id, original_text) VALUES (?, ?)');
    return stmt.run(id, originalText);
}

export function getCompressedPayload(id: string) {
    const stmt = db.prepare('SELECT original_text FROM compressed_payloads WHERE id = ?');
    return stmt.get(id) as { original_text: string } | undefined;
}

export function purgeExpiredPayloads() {
    const stmt = db.prepare("DELETE FROM compressed_payloads WHERE timestamp <= datetime('now', '-1 day')");
    return stmt.run();
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
    }, 60 * 60 * 1000); // every hour
}

// Background job to mine failed API proxy responses
export function startMemoryMiner() {
    // Dummy headroom learn-style logic
    setInterval(() => {
        // In a real implementation, this would scan proxy logs for failures
        // and distill them into rules using an LLM.
        logger.info('[SharedMemory] Mining failed API proxy responses...');
    }, 60000); // every minute
}
