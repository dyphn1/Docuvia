import * as vscode from "vscode";
import * as path from "path";
import { ExtractService } from "@workspace/core";
import { KGNode } from "../knowledge-graph-tree-provider.js";
import { KnowledgeStore } from "../knowledge-store.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";
import { TaskRunner } from "../task-runner.js";
import { KnowledgeGraphTreeProvider } from "../knowledge-graph-tree-provider.js";
import { CodeLensDecisionData } from "../docuvia-code-lens-provider.js";

export async function autoCategorizeDecisionsCommand(
  kgProvider: KnowledgeGraphTreeProvider,
  taskRunner: TaskRunner,
  node?: KGNode
) {
  if (node && node.workspaceRoot) {
    const unassignedNodes = kgProvider.getChildren(node);
    if (unassignedNodes.length > 0) {
      await taskRunner.queueAutoCategorization(node.workspaceRoot, unassignedNodes);
      vscode.commands.executeCommand("docuvia.taskQueue.focus");
    } else {
      vscode.window.showInformationMessage("No unassigned decisions to categorize.");
    }
  }
}

export async function addDecisionCommand(
  context: vscode.ExtensionContext,
  store: KnowledgeStore,
  prefillBody: string = ""
) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  const workspaceRoot = folders[0].uri.fsPath;
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    void vscode.window.showWarningMessage("Docuvia: Open a file to extract decisions from.");
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const relativePath = path.relative(workspaceRoot, filePath);

  try {
    const extractService = new ExtractService(workspaceRoot);
    const result = await extractService.extractDecisions(relativePath);

    if (result.decisions.length > 0) {
      void vscode.window.showInformationMessage(
        `Docuvia: Extracted ${result.decisions.length} decisions from ${path.basename(filePath)}.\n- ${result.decisions.join("\n- ")}`,
        { modal: true }
      );
    } else {
      void vscode.window.showInformationMessage(
        `Docuvia: No decisions found in ${path.basename(filePath)}.`
      );
    }
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Docuvia: Extraction failed - ${err.message}`);
  }
}

export async function addDecisionFromSelectionCommand(
  context: vscode.ExtensionContext,
  store: KnowledgeStore
) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Docuvia: Select code first.");
    return;
  }
  const selectedText = editor.document.getText(editor.selection);
  const langId = editor.document.languageId;
  const prefillBody = `\`\`\`${langId}\n${selectedText}\n\`\`\``;
  await addDecisionCommand(context, store, prefillBody);
}

export async function openDecisionCommand(filePath: string) {
  if (!filePath) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc);
}

export async function showDecisionsForLensCommand(
  store: KnowledgeStore,
  data: CodeLensDecisionData
) {
  const folders = vscode.workspace.workspaceFolders || [];
  const editor = vscode.window.activeTextEditor;
  const uri = editor ? editor.document.uri : folders.length > 0 ? folders[0].uri : undefined;
  if (!uri) return;

  const snapshot = store.getSnapshotFor(uri);
  const decisions = data.decisionIds
    .map((id) => snapshot?.decisions.get(id))
    .filter((d) => d !== undefined) as any[];

  if (decisions.length === 0) {
    void vscode.window.showInformationMessage("Docuvia: No decisions found for this module.");
    return;
  }

  const items = decisions.map((d) => ({
    label: d.title,
    description: `Type: ${d.type} | Status: ${d.status}`,
    decision: d,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a decision to open",
  });

  if (selected && selected.decision.filePath) {
    vscode.commands.executeCommand("docuvia.openDecision", selected.decision.filePath);
  }
}
