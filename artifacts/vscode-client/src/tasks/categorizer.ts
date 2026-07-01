import * as path from "path";
import * as vscode from "vscode";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { openLocalDatabase } from "@workspace/core";
import { KnowledgeStore, KnowledgeGraphSnapshot } from "../knowledge-store.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";
import { KGNode } from "../knowledge-graph-tree-provider.js";

const LM_FAMILY = "gpt-4o";
const LM_VENDOR = "copilot";

export class AutoCategorizationHandler {
  constructor(
    private readonly tqProvider: TaskQueueTreeProvider,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly store: KnowledgeStore
  ) {}

  async runAutoCategorizationAsync(
    taskId: string,
    workspaceRoot: string,
    unassignedNodes: KGNode[]
  ): Promise<void> {
    this.tqProvider.updateTaskStatus(taskId, "in_progress", "Selecting LM...");

    let models = await vscode.lm.selectChatModels({ vendor: LM_VENDOR, family: LM_FAMILY });
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels({ vendor: LM_VENDOR });
    }
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels();
    }
    if (models.length === 0) {
      this.tqProvider.updateTaskStatus(taskId, "failed", "No LM model available");
      return;
    }

    const model = models[0];

    const snap = this.store.snapshots.get(workspaceRoot);
    if (!snap) {
      this.tqProvider.updateTaskStatus(taskId, "failed", "Knowledge graph not loaded");
      return;
    }

    const l1TagsYaml = stringifyYaml(snap.tags);
    const l2ModulesYaml = stringifyYaml(snap.modules);

    // Prepare unassigned items payload (cap at 50 to prevent context window overflow)
    const MAX_UNASSIGNED = 50;
    const cappedNodes = unassignedNodes.slice(0, MAX_UNASSIGNED);
    if (unassignedNodes.length > MAX_UNASSIGNED) {
      this.outputChannel.appendLine(
        `[Docuvia/TaskRunner] Capping auto-categorization from ${unassignedNodes.length} to ${MAX_UNASSIGNED} decisions`
      );
    }
    const unassignedItems = cappedNodes.map((node) => {
      const decision = snap.decisions.get(node.id);
      return {
        l3_id: node.id,
        title: node.label,
        content: decision?.body ?? "",
        file_path: decision?.filePath ?? "",
      };
    });

    const prompt = `You are a code architecture assistant. Your task is to categorize unassigned L3 decisions into existing L2 modules, or propose new L2 modules under existing L1 tags.

Current L1 tags:
${l1TagsYaml}

Current L2 modules:
${l2ModulesYaml}

Unassigned Decisions:
${stringifyYaml(unassignedItems)}

Output ONLY a JSON array mapping 'l3_id' to EITHER 'target_l2_id' OR a proposed 'new_l2_name' and 'l1_id'.
Example:
[
  { "l3_id": "123", "target_l2_id": "existing-l2-id" },
  { "l3_id": "456", "new_l2_name": "My New Module", "l1_id": "existing-l1-id" }
]

Do not output any markdown formatting or explanation. Only the raw JSON array.
If you are not confident about an item, exclude it from the array.`;

    this.tqProvider.updateTaskStatus(taskId, "in_progress", "Categorizing...");

    try {
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];

      const response = await model.sendRequest(
        messages,
        {},
        new vscode.CancellationTokenSource().token
      );
      let result = "";
      for await (const part of response.text) {
        result += part;
      }

      const cleaned = result
        .replace(/^```json\n?/i, "")
        .replace(/\n?```$/, "")
        .trim();
      if (!cleaned || cleaned === "[]") {
        this.tqProvider.updateTaskStatus(taskId, "done", "No confident mappings found");
        return;
      }

      const mapping = JSON.parse(cleaned);
      if (!Array.isArray(mapping)) {
        throw new Error("LM output is not a JSON array");
      }

      await this.applyAutoCategorization(workspaceRoot, mapping, snap);

      this.tqProvider.updateTaskStatus(taskId, "done", `Categorized ${mapping.length} decision(s)`);
    } catch (err) {
      this.outputChannel.appendLine(`[Docuvia/TaskRunner] Error categorizing: ${String(err)}`);
      this.tqProvider.updateTaskStatus(taskId, "failed", `Error: ${String(err)}`);
    }
  }

  private async applyAutoCategorization(
    workspaceRoot: string,
    mapping: Array<Record<string, unknown>>,
    snap: KnowledgeGraphSnapshot
  ): Promise<void> {
    const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");

    let db: any;
    try {
      db = openLocalDatabase(dbPath);
    } catch (err) {
      this.outputChannel.appendLine(`[Docuvia/TaskRunner] Failed to open database: ${String(err)}`);
      return;
    }

    const { v4: uuidv4 } = await import("uuid");

    let changed = false;

    // First process newly proposed L2 modules to create their IDs
    for (const item of mapping) {
      if (item.new_l2_name && item.l1_id && !item.target_l2_id) {
        // check if it already exists in the newly added ones
        const stmt = db.prepare("SELECT id FROM l2_nodes WHERE name = ? AND l1_tag_id = ?");
        const existingRow = stmt.get(item.new_l2_name, item.l1_id) as any;

        if (!existingRow) {
          const slug = String(item.new_l2_name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-");

          const insertStmt = db.prepare(
            "INSERT INTO l2_nodes (slug, l1_tag_id, name, description, source_paths, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          );

          const result = insertStmt.run(
            slug,
            String(item.l1_id),
            item.new_l2_name,
            `Auto-generated module for ${item.new_l2_name}`,
            JSON.stringify([]),
            new Date().toISOString(),
            new Date().toISOString()
          );
          changed = true;
          item.target_l2_id = result.lastInsertRowid;
        } else {
          item.target_l2_id = existingRow.id;
        }
      }
    }

    // Now update router entries (l3_nodes)
    for (const item of mapping) {
      if (item.target_l2_id && item.l3_id) {
        const updateStmt = db.prepare(
          "UPDATE l3_nodes SET l2_node_id = ?, updated_at = ? WHERE id = ?"
        );
        const result = updateStmt.run(item.target_l2_id, new Date().toISOString(), item.l3_id);
        if (result.changes > 0) {
          changed = true;
        }
      }
    }

    db.close();

    if (changed) {
      await this.store.load();
    }
  }
}
