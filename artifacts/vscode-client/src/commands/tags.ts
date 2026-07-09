import * as vscode from "vscode";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { randomUUID } from "crypto";
import { openWorkspaceLocalDatabase, initializeL1TagsDatabase } from "../db-helper.js";
import { DOCUVIA_DIR_NAME, DIR_L3_DECISIONS } from "@workspace/core";
import {
  MSG_TAGS_MISSING_WORKSPACE,
  MSG_TAGS_INSERT_FAILED,
  MSG_TAGS_IMPORTED_SUCCESS,
  DocuviaCommandInvoker,
} from "../constants/index.js";

export async function acceptL1TagsCommand(yamlContent: string, explicitRoot: string) {
  const workspaceRoot = explicitRoot;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage(MSG_TAGS_MISSING_WORKSPACE);
    return;
  }

  const docuviaUri = vscode.Uri.file(path.join(workspaceRoot, DOCUVIA_DIR_NAME));
  const decisionsUri = vscode.Uri.file(
    path.join(workspaceRoot, DOCUVIA_DIR_NAME, DIR_L3_DECISIONS)
  );

  await vscode.workspace.fs.createDirectory(docuviaUri);
  await vscode.workspace.fs.createDirectory(decisionsUri);

  try {
    const tags = parseYaml(yamlContent);
    if (Array.isArray(tags)) {
      // Ensure all tags have an ID before passing to db-helper
      for (const tag of tags) {
        if (!tag.id) {
          tag.id = randomUUID();
        }
      }
      const db = openWorkspaceLocalDatabase(workspaceRoot);
      initializeL1TagsDatabase(db, tags);
      db.close();
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`${MSG_TAGS_INSERT_FAILED}${errorMsg}`);
  }

  await DocuviaCommandInvoker.executeRefreshKnowledgeGraph();
  void vscode.window.showInformationMessage(MSG_TAGS_IMPORTED_SUCCESS);
}
