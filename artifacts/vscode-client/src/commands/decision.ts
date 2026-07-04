import * as vscode from "vscode";
import * as path from "path";
import { ExtractService } from "@workspace/core";
import { KGNode, KnowledgeGraphTreeProvider } from "../knowledge-graph-tree-provider.js";

export async function autoCategorizeDecisionsCommand(
  kgProvider: KnowledgeGraphTreeProvider,
  node?: KGNode
) {
  vscode.window.showInformationMessage(
    "Auto-categorization is handled by the server ingestion pipeline."
  );
}

export async function addDecisionCommand(
  context: vscode.ExtensionContext,
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

export async function addDecisionFromSelectionCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Docuvia: Select code first.");
    return;
  }
  const selectedText = editor.document.getText(editor.selection);
  const langId = editor.document.languageId;
  const prefillBody = `\`\`\`${langId}\n${selectedText}\n\`\`\``;
  await addDecisionCommand(context, prefillBody);
}

export async function openDecisionCommand(filePath: string) {
  if (!filePath) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc);
}

export async function showDecisionsForLensCommand(data: { module: any; decisions: any[] }) {
  const decisions = data.decisions || [];

  if (decisions.length === 0) {
    void vscode.window.showInformationMessage("Docuvia: No decisions found for this module.");
    return;
  }

  const items = decisions.map((d) => ({
    label: d.title,
    description: `Type: ${d.type || "N/A"} | Status: ${d.status}`,
    decision: d,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a decision to open",
  });

  if (selected && selected.decision.filePath) {
    vscode.commands.executeCommand("docuvia.openDecision", selected.decision.filePath);
  }
}
