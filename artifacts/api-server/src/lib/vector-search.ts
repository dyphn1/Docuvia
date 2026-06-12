import { db } from "@workspace/db";
import { l3NodesTable } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";

export interface VectorSearchResult {
  id: number;
  title: string;
  content: string | null;
  nodeType: string;
  score: number;
}

export async function performVectorSearch(
  embedding: number[],
  projectId?: number,
  limit = 10,
  includePending = false
): Promise<VectorSearchResult[]> {
  const vectorStr = `[${embedding.join(",")}]`;
  
  // Hard filters to drastically reduce scan space before calculating vector distance
  const conditions = [];
  if (projectId) {
     // we'd typically join l2NodesTable, but keeping it generic based on existing schema
     conditions.push(sql`${l3NodesTable.l2NodeId} IN (SELECT id FROM l2_nodes WHERE project_id = ${projectId})`);
  }
  if (!includePending) {
     conditions.push(eq(l3NodesTable.validityStatus, 'active'));
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Cosine distance over JSONB using raw SQL math (assume standard PG arrays or pgvector eventually)
  // Implementing exponential temporal decay on the score
  const query = db
    .select({
      id: l3NodesTable.id,
      title: l3NodesTable.title,
      content: l3NodesTable.content,
      nodeType: l3NodesTable.nodeType,
      rawScore: sql<number>`1 - (embedding::vector <=> ${vectorStr}::vector)`,
      decayedScore: sql<number>`(1 - (embedding::vector <=> ${vectorStr}::vector)) * EXP(-0.05 * EXTRACT(EPOCH FROM (NOW() - COALESCE(last_verified_at, created_at)))/86400)`
    })
    .from(l3NodesTable)
    .where(whereClause)
    .orderBy(sql`(1 - (embedding::vector <=> ${vectorStr}::vector)) * EXP(-0.05 * EXTRACT(EPOCH FROM (NOW() - COALESCE(last_verified_at, created_at)))/86400) DESC`)
    .limit(limit);

  const results = await query;
  return results.map(r => ({
    id: r.id,
    title: r.title,
    content: r.content,
    nodeType: r.nodeType,
    score: r.decayedScore
  }));
}