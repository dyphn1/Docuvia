import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { eq, or, like, desc, and } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';

export const l2Nodes = sqliteTable('l2_nodes', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug'),
  source_paths: text('source_paths')
});

export const l3Nodes = sqliteTable('l3_nodes', {
  id: integer('id').primaryKey(),
  l2NodeId: integer('l2_node_id').references(() => l2Nodes.id),
  title: text('title').notNull(),
  content: text('content'),
  status: text('status'),
  createdAt: integer('created_at', { mode: 'timestamp' })
});

export async function queryCommand(target: string, options: { local?: boolean; format?: 'human' | 'prompt' }) {
  if (options.local) {
    console.error(`[docuvia] Performing offline local SQLite search for: ${target}`);
  }

  const workspaceRoot = process.cwd(); // Assume CLI is run from workspace root
  const dbPath = path.join(workspaceRoot, '.docuvia', 'local.db');

  if (!fs.existsSync(dbPath)) {
    console.error('Error: Local database not found. Please run "docuvia.initProject" from VS Code to initialize it.');
    process.exit(1);
  }

  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  const likeTarget = `%${target}%`;

  const matchingL2 = db
    .select()
    .from(l2Nodes)
    .where(
      or(
        like(l2Nodes.name, likeTarget),
        like(l2Nodes.slug, likeTarget),
        like(l2Nodes.source_paths, likeTarget)
      )
    )
    .limit(1)
    .get();

  let results: { l2?: typeof l2Nodes.$inferSelect, l3: typeof l3Nodes.$inferSelect[] } = { l3: [] };

  if (matchingL2) {
    results.l2 = matchingL2;
    const matchingL3 = db
      .select()
      .from(l3Nodes)
      .where(
        and(
          eq(l3Nodes.l2NodeId, matchingL2.id),
          or(like(l3Nodes.title, likeTarget), like(l3Nodes.content, likeTarget))
        )
      )
      .orderBy(desc(l3Nodes.createdAt))
      .limit(5)
      .all();

    if (matchingL3.length < 5) {
      const recentL3 = db
        .select()
        .from(l3Nodes)
        .where(eq(l3Nodes.l2NodeId, matchingL2.id))
        .orderBy(desc(l3Nodes.createdAt))
        .limit(5)
        .all();
      
      const existingIds = new Set(matchingL3.map(l => l.id));
      for (const item of recentL3) {
        if (!existingIds.has(item.id)) {
          matchingL3.push(item);
          if (matchingL3.length >= 5) break;
        }
      }
    }
    results.l3 = matchingL3;
  } else {
    results.l3 = db
      .select()
      .from(l3Nodes)
      .where(or(like(l3Nodes.title, likeTarget), like(l3Nodes.content, likeTarget)))
      .orderBy(desc(l3Nodes.createdAt))
      .limit(5)
      .all();
  }

  if (options.format === 'prompt') {
    let output = `<docuvia_context>\n`;
    if (results.l2) {
      output += `  <l2_module name="${results.l2.name}">\n`;
    }
    for (const l3 of results.l3) {
      output += `    <l3_decision title="${l3.title}" status="${l3.status || 'unknown'}">\n      ${l3.content || ''}\n    </l3_decision>\n`;
    }
    if (results.l2) {
      output += `  </l2_module>\n`;
    }
    output += `</docuvia_context>`;
    console.log(output);
  } else {
    console.log(`\x1b[1m\x1b[36m=== Docuvia Context ===\x1b[0m\n`);
    if (results.l2) {
      console.log(`\x1b[35m[L2 Module]\x1b[0m ${results.l2.name}`);
    } else {
      console.log(`\x1b[33mNo matching L2 module found. Showing global results.\x1b[0m`);
    }
    console.log(``);
    for (const l3 of results.l3) {
      console.log(`\x1b[32m[Decision]\x1b[0m ${l3.title} \x1b[90m(${l3.status || 'unknown'})\x1b[0m`);
      if (l3.content) {
        console.log(`  ${l3.content.split('\n').join('\n  ')}`);
      }
      console.log(``);
    }
    console.log(`\x1b[1m\x1b[36m=======================\x1b[0m`);
  }
}
