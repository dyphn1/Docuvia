import crypto from "crypto";
import path from "path";
import Database from "better-sqlite3";
import { ScopeResolver } from "./scope-resolver.js";
import { IGraphDatabaseRepository } from "../interfaces/analyzer.interfaces.js";

export class GraphDatabaseRepository implements IGraphDatabaseRepository {
  public async persistAstGraph(
    workspaceRoot: string,
    parsedResults: any[],
    tags: string[]
  ): Promise<{ updatedCount: number; fileIdMap: Map<string, string> }> {
    const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");
    const db = new Database(dbPath);

    const resolver = new ScopeResolver(workspaceRoot);
    for (const result of parsedResults) {
      const locals: string[] = [];
      if (result.data.functions) locals.push(...result.data.functions.map((f: any) => f.name));
      if (result.data.classes) locals.push(...result.data.classes.map((c: any) => c.name));
      resolver.registerFile(result.file, result.data.imports || [], [], locals);
    }

    // Transaction for bulk inserting the new AST nodes
    const insertHash = db.prepare(
      "INSERT INTO project_files (project_id, file_path, content_hash) VALUES (1, ?, ?) ON CONFLICT (project_id, file_path) DO UPDATE SET content_hash = excluded.content_hash, last_parsed_at = CURRENT_TIMESTAMP"
    );
    const deleteOldL1Links = db.prepare(
      "DELETE FROM l2_node_l1_tags WHERE l2_node_id IN (SELECT id FROM l2_nodes WHERE source_paths = ?)"
    );
    const deleteOldLinks = db.prepare(
      "DELETE FROM node_links WHERE source_node_id IN (SELECT id FROM l2_nodes WHERE source_paths = ?)"
    );
    const deleteOldNodes = db.prepare("DELETE FROM l2_nodes WHERE source_paths = ?");
    const insertNode = db.prepare(
      "INSERT INTO l2_nodes (id, name, slug, type, source_paths, description) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertLink = db.prepare(
      "INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES (?, ?, ?)"
    );
    const insertL1Tag = db.prepare(
      "INSERT INTO l1_tags (id, name, slug, description) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING"
    );
    const insertL2L1Link = db.prepare(
      "INSERT INTO l2_node_l1_tags (l2_node_id, l1_tag_id) VALUES (?, ?)"
    );

    const runTransaction = db.transaction(() => {
      let parsedCount = 0;
      const fileIdMap = new Map<string, string>();

      // Ensure all tags exist
      for (const tag of tags) {
        insertL1Tag.run(tag, tag, tag, `Auto-detected tag: ${tag}`);
      }

      for (const result of parsedResults) {
        const sourcePathJson = JSON.stringify([result.file]);

        // Clean up old nodes for this file
        deleteOldL1Links.run(sourcePathJson);
        deleteOldLinks.run(sourcePathJson);
        deleteOldNodes.run(sourcePathJson);

        // Insert new nodes
        const fileId = crypto.randomUUID();
        fileIdMap.set(result.file, fileId);
        insertNode.run(fileId, result.file, result.file, "file", sourcePathJson, "");

        // Link L2 file node to L1 tags
        for (const tag of tags) {
          insertL2L1Link.run(fileId, tag);
        }

        if (result.data.functions) {
          for (const fn of result.data.functions) {
            const fnId = crypto.randomUUID();
            insertNode.run(fnId, fn.name, fn.name, "function", sourcePathJson, "");
            insertLink.run(fileId, fnId, "contains");
          }
        }

        if (result.data.classes) {
          for (const cls of result.data.classes) {
            const clsId = crypto.randomUUID();
            insertNode.run(clsId, cls.name, cls.name, "class", sourcePathJson, "");
            insertLink.run(fileId, clsId, "contains");
          }
        }
      }

      // Pass 2: Resolve edges using the ScopeResolver and create them
      for (const result of parsedResults) {
        const sourceFileId = fileIdMap.get(result.file);
        if (!sourceFileId) continue;

        if (result.data.calls) {
          for (const call of result.data.calls) {
            const resolved = resolver.resolveCall(result.file, call.targetFunction);
            if (resolved) {
              // Link file to file directly, avoiding ambiguous function names across the db
              const targetPathJson = JSON.stringify([resolved.targetFile]);
              let targetFileId = fileIdMap.get(resolved.targetFile);

              if (!targetFileId) {
                const row = db
                  .prepare("SELECT id FROM l2_nodes WHERE type = 'file' AND source_paths = ?")
                  .get(targetPathJson) as { id: string } | undefined;
                if (row) targetFileId = row.id;
              }

              if (targetFileId && targetFileId !== sourceFileId) {
                // avoid self-calls clutter
                insertLink.run(sourceFileId, targetFileId, "calls");
              }
            }
          }
        }

        // Update hash
        insertHash.run(result.file, result.hash);
        parsedCount++;
      }
      return { updatedCount: parsedCount, fileIdMap };
    });

    const { updatedCount, fileIdMap } = runTransaction();
    db.close();
    return { updatedCount, fileIdMap };
  }
}
