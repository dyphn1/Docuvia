import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join(process.cwd(), 'data', 'ast_quarantine.db');

// Ensure directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
    CREATE TABLE IF NOT EXISTS quarantine_blacklist (
        file_path TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

export function isQuarantined(filePath: string): boolean {
    const stmt = db.prepare('SELECT 1 FROM quarantine_blacklist WHERE file_path = ?');
    return !!stmt.get(filePath);
}

export function quarantineFile(filePath: string): void {
    const stmt = db.prepare('INSERT OR IGNORE INTO quarantine_blacklist (file_path) VALUES (?)');
    stmt.run(filePath);
}
