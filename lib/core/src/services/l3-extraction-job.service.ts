import { Worker } from "worker_threads";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { existsSync } from "fs";
import { IL3ExtractionJob } from "../interfaces/analyzer.interfaces.js";

export class L3ExtractionJobService implements IL3ExtractionJob {
  public triggerBackgroundExtraction(
    workspaceRoot: string,
    filesToParse: any[],
    fileIdMap: Map<string, number>
  ): void {
    console.log(`[docuvia] Triggering background L3 Agentic RAG extraction...`);
    const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");

    setTimeout(async () => {
      let backgroundDb;
      try {
        if (existsSync(dbPath)) {
          backgroundDb = new Database(dbPath);
        }
        if (!backgroundDb) return;

        const { ExtractService } = await import("./extract-service.js");
        const extractService = new ExtractService(workspaceRoot);

        // Initialize l3_nodes schema if not exists just in case
        backgroundDb.exec(`
          CREATE TABLE IF NOT EXISTS l3_nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            l2_node_id INTEGER,
            title TEXT,
            content TEXT,
            status TEXT,
            created_at TEXT
          );
        `);

        const insertL3Node = backgroundDb.prepare(
          "INSERT INTO l3_nodes (l2_node_id, title, content, status, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
        );

        for (const item of filesToParse) {
          const l2NodeId = fileIdMap.get(item.file);
          if (!l2NodeId) continue;

          try {
            const result = await extractService.extractDecisions(item.file);
            if ((result as any).error) {
              continue; // Skip failed extractions
            }

            // Clear old l3 nodes for this l2_node before inserting new ones
            backgroundDb.prepare("DELETE FROM l3_nodes WHERE l2_node_id = ?").run(l2NodeId);

            if (result.decisions) {
              for (const decision of result.decisions) {
                insertL3Node.run(l2NodeId, decision, "", "active");
              }
            }
          } catch (e: any) {
            console.error(`[docuvia] L3 Extraction Error for file ${item.file}:`, e.message);
          }
        }
      } catch (e: any) {
        console.error(`[docuvia] Background L3 extraction failed to initialize:`, e.message);
      } finally {
        if (backgroundDb) {
          backgroundDb.close();
        }
      }
    }, 0);
  }
}
