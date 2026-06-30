import path from "path";
import fs from "fs";
import { openLocalDatabase } from "./DatabaseHelper.js";

export class SyncService {
  constructor(
    private workspaceRoot: string,
    private apiUrl: string,
    private mcpPat: string,
    private onProgress?: (msg: string) => void
  ) {}

  public async sync(projectId: string, commitSha?: string): Promise<void> {
    const formattedApiUrl = this.apiUrl.replace(/\/+$/, "");
    if (this.onProgress) {
      this.onProgress(`Syncing project ${projectId}...`);
    }

    const res = await fetch(`${formattedApiUrl}/api/projects/${projectId}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.mcpPat}`,
        "Content-Type": "application/json",
      },
      body: commitSha ? JSON.stringify({ commitSha }) : undefined,
    });

    const body = (await res.json()) as { error?: string; message?: string };
    if (!res.ok) {
      throw new Error(String(body.error ?? "Sync failed"));
    }

    if (this.onProgress) {
      this.onProgress(String(body.message ?? "Server ingestion complete. Fetching graph data..."));
    }

    // Fetch graph data (edges/nodes) and update local DB
    const graphRes = await fetch(`${formattedApiUrl}/api/projects/${projectId}/graph`, {
      headers: {
        Authorization: `Bearer ${this.mcpPat}`,
      },
    });

    if (!graphRes.ok) {
      throw new Error(`Failed to fetch graph data: ${graphRes.statusText}`);
    }

    const graphData = (await graphRes.json()) as any;
    
    // Update local DB
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (fs.existsSync(dbPath)) {
      const db = openLocalDatabase(dbPath);
      try {
        db.transaction(() => {
          // Sync L2 Nodes
          if (graphData.l2Nodes) {
            const stmt = db.prepare("INSERT OR REPLACE INTO l2_nodes (id, name, slug, type, source_paths, l1_tag_id, description) VALUES (?, ?, ?, ?, ?, ?, ?)");
            for (const node of graphData.l2Nodes) {
              // Get the first l1_tag_id if available
              const l1TagId = node.l1TagIds && node.l1TagIds.length > 0 ? Number(node.l1TagIds[0]) : null;
              stmt.run(
                Number(node.id),
                node.name,
                node.slug,
                node.type || null,
                JSON.stringify(node.sourcePaths || []),
                l1TagId,
                node.description || null
              );
            }
          }

          // Sync Node Links (Edges)
          if (graphData.nodeLinks) {
            const stmt = db.prepare("INSERT OR REPLACE INTO node_links (id, source_node_id, target_node_id, link_type) VALUES (?, ?, ?, ?)");
            for (const link of graphData.nodeLinks) {
              stmt.run(
                Number(link.id),
                Number(link.sourceNodeId),
                Number(link.targetNodeId),
                link.linkType || null
              );
            }
          }
        })();
      } finally {
        db.close();
      }
    }

    if (this.onProgress) {
      this.onProgress("Sync completed");
    }
  }
}

