import * as vscode from "vscode";
import * as path from "path";
import { randomUUID } from "crypto";
import { minimatch } from "minimatch";
import {
  ExtractService,
  openWorkspaceLocalDatabase,
  resolveL2NodeIdForFile,
} from "@workspace/core";
import { addDecisionCommand } from "./decision.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";

export async function runExtractionCommand(tqProvider?: TaskQueueTreeProvider) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Docuvia: Open a file to extract decisions from.");
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");

  const config = vscode.workspace.getConfiguration("docuvia");
  const includePatterns = config.get<string[]>("extraction.includePatterns", []);

  if (includePatterns.length > 0) {
    const isIncluded = includePatterns.some((pattern) => minimatch(relativePath, pattern));
    if (!isIncluded) {
      const proceed = await vscode.window.showWarningMessage(
        `Docuvia: This file type (${path.basename(filePath)}) is not in your include list. Analyze it anyway?`,
        "Yes",
        "No"
      );
      if (proceed !== "Yes") return;
    }
  }

  const taskId = randomUUID();
  tqProvider?.addTask({
    id: taskId,
    label: path.basename(filePath),
    type: "l3_extraction",
    status: "in_progress",
    createdAt: new Date(),
  });

  void vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Extracting decisions from ${path.basename(filePath)}`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const extractService = new ExtractService(workspaceRoot);
        const result = await extractService.extractDecisions(relativePath);

        if (result.decisions && result.decisions.length > 0) {
          const decisionsMsg = result.decisions.map((d) => `- ${d}`).join("\n");
          const action = await vscode.window.showInformationMessage(
            `Extracted ${result.decisions.length} decisions:\n\n${decisionsMsg}`,
            { modal: true },
            "Save as Decision Record"
          );

          if (action === "Save as Decision Record") {
            const db = openWorkspaceLocalDatabase(workspaceRoot);
            const l2NodeId = resolveL2NodeIdForFile(db, relativePath);
            const insert = db.prepare(
              "INSERT INTO l3_nodes (l2_node_id, title, slug, status, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            );

            db.transaction(() => {
              for (const d of result.decisions) {
                const title = `Extracted from ${path.basename(filePath)}`;
                const slug = `extracted-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                insert.run(l2NodeId, title, slug, "proposed", d, new Date().toISOString());
              }
            })();
            db.close();

            vscode.window.showInformationMessage("Decisions saved successfully.");
            vscode.commands.executeCommand("docuvia.knowledgeGraph.refresh");
          }
        } else {
          vscode.window.showInformationMessage(
            `No decisions extracted from ${path.basename(filePath)}.`
          );
        }
        tqProvider?.updateTaskStatus(taskId, "done", `${result.decisions?.length ?? 0} decisions`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Extraction failed: ${err.message}`);
        tqProvider?.updateTaskStatus(taskId, "failed", err.message);
      }
    }
  );
}
