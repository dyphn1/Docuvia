import * as vscode from "vscode";
import * as path from "path";
import { ExtractService } from "@workspace/core";
import { KGNode, KnowledgeGraphTreeProvider } from "../knowledge-graph-tree-provider.js";
import {
  MSG_AUTO_CATEGORIZE_INFO,
  MSG_OPEN_FILE_EXTRACT_WARNING,
  MSG_SELECT_CODE_WARNING,
  MSG_NO_DECISIONS_FOR_MODULE,
  MSG_SELECT_DECISION_TO_OPEN,
  MSG_DECISION_EXTRACTED_FROM,
  MSG_DECISION_NONE_FOUND,
  MSG_DECISION_EXTRACTION_FAILED,
  DocuviaCommandInvoker,
} from "../constants/index.js";

export async function autoCategorizeDecisionsCommand(
  kgProvider: KnowledgeGraphTreeProvider,
  node?: KGNode
) {
  vscode.window.showInformationMessage(MSG_AUTO_CATEGORIZE_INFO);
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
    void vscode.window.showWarningMessage(MSG_OPEN_FILE_EXTRACT_WARNING);
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const relativePath = path.relative(workspaceRoot, filePath);

  try {
    const extractService = new ExtractService(workspaceRoot);
    const result = await extractService.extractDecisions(relativePath);

    if (result.decisions.length > 0) {
      void vscode.window.showInformationMessage(
        MSG_DECISION_EXTRACTED_FROM.replace("{0}", String(result.decisions.length))
          .replace("{1}", path.basename(filePath))
          .replace("{2}", result.decisions.map((d) => d.title).join("\n- ")),
        { modal: true }
      );
    } else {
      void vscode.window.showInformationMessage(
        MSG_DECISION_NONE_FOUND.replace("{0}", path.basename(filePath))
      );
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${MSG_DECISION_EXTRACTION_FAILED}${errorMsg}`);
  }
}

export async function addDecisionFromSelectionCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage(MSG_SELECT_CODE_WARNING);
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
    void vscode.window.showInformationMessage(MSG_NO_DECISIONS_FOR_MODULE);
    return;
  }

  const items = decisions.map((d) => ({
    label: d.title,
    description: `Type: ${d.type || "N/A"} | Status: ${d.status}`,
    decision: d,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: MSG_SELECT_DECISION_TO_OPEN,
  });

  if (selected && selected.decision.filePath) {
    await DocuviaCommandInvoker.executeOpenDecision(selected.decision.filePath);
  }
}
