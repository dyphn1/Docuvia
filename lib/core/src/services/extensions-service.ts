import { db } from "@workspace/db";
import {
  l3NodesTable,
  l2NodesTable,
  documentsTable,
  activityLogTable,
  projectsTable,
} from "@workspace/db";
import { eq, like, isNotNull, or, and, sql } from "drizzle-orm";
import { generateEmbedding } from "./embedding.js";
import { routeQuery } from "./intent-router.js";
import { logger } from "./logger.js";

export async function vscodeQuery(q: string, projectId?: number, limit = 10) {
  return routeQuery(q, projectId, limit);
}

export interface VscodeCreateDecisionPayload {
  projectId: number;
  l2NodeId?: number;
  filePath?: string;
  agreeToLinkSource?: boolean;
  l3Node: {
    title: string;
    content?: string;
    nodeType?: string;
    commitHash?: string;
    aiGenerated?: boolean;
    confidence?: number;
  };
}

export async function createL3Decision(payload: VscodeCreateDecisionPayload) {
  const l2NodeId = payload.l2NodeId ?? null;
  if (!l2NodeId) throw new Error("l2NodeId required");

  const [l2Node] = await db
    .select({ projectId: l2NodesTable.projectId })
    .from(l2NodesTable)
    .where(eq(l2NodesTable.id, l2NodeId));
  const projectId = l2Node?.projectId;
  if (!projectId) throw new Error("l2Node not found");
  const emb = await generateEmbedding(
    projectId,
    payload.l3Node.content ?? payload.l3Node.title ?? ""
  );
  const embRaw = emb ?? null;

  const [node] = await db
    .insert(l3NodesTable)
    .values({
      l2NodeId,
      title: payload.l3Node.title,
      content: payload.l3Node.content ?? null,
      nodeType: (payload.l3Node.nodeType ?? "decision") as any,
      commitHash: payload.l3Node.commitHash ?? null,
      aiGenerated: payload.l3Node.aiGenerated ?? false,
      confidence: payload.l3Node.confidence ?? null,
      embedding: embRaw,
    })
    .returning();

  // Try to create a source-ref entry if the migration/table exists. Non-fatal if missing.
  if (payload.agreeToLinkSource && payload.filePath) {
    try {
      await db.execute(
        sql`INSERT INTO l3_node_source_refs (l3_node_id, source_type, source_path, created_at) VALUES (${node.id}, 'file', ${payload.filePath}, now())`
      );
    } catch (err) {
      logger.warn(
        { err },
        "l3_node_source_refs table missing or insert failed; skipping source ref"
      );
    }
  }

  // Log activity (attempt to resolve projectId from L2 node)
  try {
    const [l2] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, l2NodeId));
    await db.insert(activityLogTable).values({
      type: "l3_created",
      description: `L3 node "${node.title}" created via VSCode extension`,
      projectId: l2?.projectId ?? payload.projectId ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to write activity log for L3 creation");
  }

  return { ...node, createdAt: node.createdAt.toISOString() };
}

export async function getFileContext(pathStr: string, projectId?: number) {
  const basename = pathStr.split(/[\\/]/).pop() ?? pathStr;
  const pattern = `%${basename}%`;

  // L2 nodes by name or description
  let l2Query = db
    .select()
    .from(l2NodesTable)
    .where(
      or(
        like(l2NodesTable.name, pattern),
        like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)
      )
    )
    .$dynamic();
  if (projectId) l2Query = l2Query.where(eq(l2NodesTable.projectId, projectId));
  const l2Nodes = await l2Query.limit(20);

  // L3 nodes by title/content
  let l3Query: any = db
    .select()
    .from(l3NodesTable)
    .where(
      or(
        like(l3NodesTable.title, pattern),
        like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)
      )
    )
    .$dynamic();
  if (projectId) {
    // Try to restrict by l2 node project via join
    l3Query = db
      .select()
      .from(l3NodesTable)
      .leftJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
      .where(
        and(
          eq(l2NodesTable.projectId, projectId),
          or(
            like(l3NodesTable.title, pattern),
            like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)
          )
        )
      );
  }
  const l3Nodes = await l3Query.limit(40);

  // Documents that match filename
  let docQuery = db
    .select()
    .from(documentsTable)
    .where(like(documentsTable.filename, `%${basename}%`))
    .$dynamic();
  if (projectId) docQuery = docQuery.where(eq(documentsTable.projectId, projectId));
  const docs = await docQuery.limit(20);

  const sources: Array<Record<string, unknown>> = [];
  for (const d of docs) {
    sources.push({
      sourceType: "document",
      sourceId: d.id,
      excerpt: d.content?.slice(0, 300) ?? "",
      score: 1.0,
    });
  }
  for (const n of l3Nodes as any[]) {
    sources.push({
      sourceType: "l3",
      sourceId: n.id,
      excerpt: (n.content ?? "").slice(0, 300),
      score: 0.9,
    });
  }

  return {
    path: pathStr,
    projectId: projectId ?? null,
    l2Nodes: l2Nodes.map((n: any) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    l3Nodes: (l3Nodes as any[]).map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    sources,
  };
}
