import { IVectorSearchHandler } from "../../interfaces/intent-router.interfaces.js";
import { AgenticSearchResult } from "../../types/intent-router.types.js";
import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable, projectsTable } from "@workspace/db";
import { eq, like, or, and, sql } from "drizzle-orm";
import { generateEmbedding } from "../embedding.js";
import { applyTemporalDecay } from "./router.utils.js";
import { sanitizeLikeInput } from "../../utils/sql-utils.js";

export class VectorSearchService implements IVectorSearchHandler {
  async search(
    query: string,
    projectId?: number,
    limit = 10,
    includePending = false
  ): Promise<AgenticSearchResult[]> {
    const results: AgenticSearchResult[] = [];
    const queryEmbedding = await generateEmbedding(projectId, query);

    if (queryEmbedding) {
      const vectorStr = `[${queryEmbedding.join(",")}]`;
      const l2Limit = limit;

      // L2 nodes: pgvector similarity search with temporal decay
      const l2Sql = sql`
        SELECT
          l2.id, l2.name, l2.description, l2.project_id, l2.created_at, l2.last_verified_at,
          p.name as project_name,
          (1 - (l2.embedding::vector <=> ${vectorStr}::vector)) * EXP(-0.05 * EXTRACT(EPOCH FROM (NOW() - COALESCE(l2.last_verified_at, l2.created_at)))/86400) as score
        FROM l2_nodes l2
        LEFT JOIN projects p ON p.id = l2.project_id
        WHERE l2.embedding IS NOT NULL
        ${projectId != null ? sql`AND l2.project_id = ${projectId}` : sql``}
        ORDER BY score DESC
        LIMIT ${l2Limit}
      `;
      const l2Rows = await db.execute(l2Sql);

      for (const row of l2Rows.rows ?? []) {
        results.push({
          source: "vector",
          nodeLayer: "l2",
          id: (row as any).id,
          title: (row as any).name,
          content: (row as any).description ?? null,
          projectId: (row as any).project_id,
          projectName: (row as any).project_name ?? null,
          score: (row as any).score,
          createdAt: new Date((row as any).created_at).toISOString(),
        });
      }

      // L3 nodes: pgvector similarity search with temporal decay
      const l3ValidityFilter = includePending
        ? sql`AND l3.validity_status IN ('valid', 'pending')`
        : sql`AND l3.validity_status = 'valid'`;

      const l3Sql = sql`
        SELECT
          l3.id, l3.title, l3.content, l3.node_type, l3.created_at, l3.last_verified_at,
          l2.project_id,
          p.name as project_name,
          (1 - (l3.embedding::vector <=> ${vectorStr}::vector)) * EXP(-0.05 * EXTRACT(EPOCH FROM (NOW() - COALESCE(l3.last_verified_at, l3.created_at)))/86400) as score
        FROM l3_nodes l3
        INNER JOIN l2_nodes l2 ON l2.id = l3.l2_node_id
        LEFT JOIN projects p ON p.id = l2.project_id
        WHERE l3.embedding IS NOT NULL ${l3ValidityFilter}
        ${projectId != null ? sql`AND l2.project_id = ${projectId}` : sql``}
        ORDER BY score DESC
        LIMIT ${limit}
      `;
      const l3Rows = await db.execute(l3Sql);

      for (const row of l3Rows.rows ?? []) {
        results.push({
          source: "vector",
          nodeLayer: "l3",
          id: (row as any).id,
          title: (row as any).title,
          content: (row as any).content ?? null,
          projectId: (row as any).project_id,
          projectName: (row as any).project_name ?? null,
          score: (row as any).score,
          createdAt: new Date((row as any).created_at).toISOString(),
        });
      }
    } else {
      // Fallback: SQL LIKE search (no embedding available)
      const escapedQuery = sanitizeLikeInput(query);
      const pattern = `%${escapedQuery}%`;

      const l3ValidityCondition = includePending
        ? or(eq(l3NodesTable.validityStatus, "valid"), eq(l3NodesTable.validityStatus, "pending"))
        : eq(l3NodesTable.validityStatus, "valid");

      let l2FallbackQuery = db.select().from(l2NodesTable).$dynamic();
      if (projectId) {
        l2FallbackQuery = l2FallbackQuery.where(
          and(
            or(
              like(l2NodesTable.name, pattern),
              like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)
            ),
            eq(l2NodesTable.projectId, projectId)
          )
        );
      } else {
        l2FallbackQuery = l2FallbackQuery.where(
          or(
            like(l2NodesTable.name, pattern),
            like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)
          )
        );
      }
      const l2Rows = await l2FallbackQuery.limit(limit);

      for (const node of l2Rows) {
        const [proj] = await db
          .select({ name: projectsTable.name })
          .from(projectsTable)
          .where(eq(projectsTable.id, node.projectId));
        results.push({
          source: "vector",
          nodeLayer: "l2",
          id: node.id,
          title: node.name,
          content: node.description ?? null,
          projectId: node.projectId,
          projectName: proj?.name ?? null,
          score: applyTemporalDecay(0.9, node.lastVerifiedAt ?? node.createdAt),
          createdAt: node.createdAt.toISOString(),
        });
      }

      let l3FallbackQuery = db
        .select({
          node: l3NodesTable,
          projectId: l2NodesTable.projectId,
          projectName: projectsTable.name,
        })
        .from(l3NodesTable)
        .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
        .leftJoin(projectsTable, eq(l2NodesTable.projectId, projectsTable.id))
        .$dynamic();

      const l3FallbackConditions = [
        l3ValidityCondition,
        or(
          like(l3NodesTable.title, pattern),
          like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)
        ),
      ];

      if (projectId) {
        l3FallbackConditions.push(eq(l2NodesTable.projectId, projectId));
      }

      l3FallbackQuery = l3FallbackQuery.where(and(...l3FallbackConditions)).limit(limit);

      const l3Rows = await l3FallbackQuery;

      for (const { node, projectId, projectName } of l3Rows) {
        results.push({
          source: "vector",
          nodeLayer: "l3",
          id: node.id,
          title: node.title,
          content: node.content ?? null,
          projectId,
          projectName,
          score: applyTemporalDecay(0.8, node.lastVerifiedAt ?? node.createdAt),
          createdAt: node.createdAt.toISOString(),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
