import * as vscode from "vscode";
import * as path from "path";
import { KGNode } from "../knowledge-graph-tree-provider.js";
import { LocalGraphTraversalService, LocalSnapshotService, TraversalResult } from "@workspace/core";
import {
  MSG_GRAPH_REFRESHED,
  MSG_GRAPH_NO_WORKSPACE,
  MSG_GRAPH_NO_MODULES,
  MSG_GRAPH_SELECT_MODULE,
  MSG_GRAPH_DIR_DEPENDENCIES,
  MSG_GRAPH_DIR_DEPENDENTS,
  MSG_GRAPH_DIR_BOTH,
  MSG_GRAPH_WORKSPACE_NOT_FOUND,
  MSG_GRAPH_TRAVERSAL_FAILED,
  MSG_GRAPH_DIR_PLACEHOLDER,
  MSG_GRAPH_TRAVERSAL_OUTPUT_TITLE,
  MSG_GRAPH_TRAVERSAL_HEADER,
  MSG_GRAPH_TRAVERSAL_STATS,
  MSG_GRAPH_TRAVERSAL_EDGES_TITLE,
  MSG_GRAPH_TRAVERSAL_NODE_PREFIX_ROOT,
  MSG_GRAPH_TRAVERSAL_NODE_PREFIX_CHILD,
  MSG_GRAPH_TRAVERSAL_NODE_LINE,
  MSG_GRAPH_TRAVERSAL_EDGE_LINE,
  DocuviaCommandInvoker,
} from "../constants/index.js";

export async function refreshKnowledgeGraphCommand() {
  await DocuviaCommandInvoker.executeRefreshKnowledgeGraph(); // Or however we want to trigger tree refresh
  void vscode.window.showInformationMessage(MSG_GRAPH_REFRESHED);
}

export async function traverseGraphCommand(outputChannel: vscode.OutputChannel, node?: KGNode) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage(MSG_GRAPH_NO_WORKSPACE);
    return;
  }

  let rootNodeId: number | undefined;
  if (node && node.kind === "l2module" && node.workspaceRoot) {
    rootNodeId = Number(node.id);
  } else {
    const items: vscode.QuickPickItem[] = [];
    for (const folder of folders) {
      const snap = new LocalSnapshotService(folder.uri.fsPath).getSnapshot();
      if (snap) {
        for (const mod of snap.modules) {
          items.push({
            label: mod.name,
            description: path.basename(folder.uri.fsPath),
            detail: `ID: ${mod.id}`,
          });
        }
      }
    }
    if (items.length === 0) {
      void vscode.window.showWarningMessage(MSG_GRAPH_NO_MODULES);
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: MSG_GRAPH_SELECT_MODULE,
    });
    if (!picked?.detail) return;
    rootNodeId = Number(picked.detail.replace("ID: ", ""));
  }

  if (rootNodeId === undefined || isNaN(rootNodeId)) return;

  const direction = await vscode.window.showQuickPick<
    vscode.QuickPickItem & { value: "dependencies" | "dependents" | "both" }
  >(
    [
      {
        label: "$(arrow-down) Dependencies",
        description: MSG_GRAPH_DIR_DEPENDENCIES,
        value: "dependencies",
      },
      {
        label: "$(arrow-up) Dependents (Impact)",
        description: MSG_GRAPH_DIR_DEPENDENTS,
        value: "dependents",
      },
      {
        label: "$(arrow-both) Both Directions",
        description: MSG_GRAPH_DIR_BOTH,
        value: "both",
      },
    ],
    { placeHolder: MSG_GRAPH_DIR_PLACEHOLDER }
  );
  if (!direction) return;

  let workspaceRoot: string | undefined;
  for (const folder of folders) {
    const snap = new LocalSnapshotService(folder.uri.fsPath).getSnapshot();
    if (snap?.modules.find((m: { id: number | string }) => Number(m.id) === rootNodeId)) {
      workspaceRoot = folder.uri.fsPath;
      break;
    }
  }
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage(MSG_GRAPH_WORKSPACE_NOT_FOUND);
    return;
  }

  const result: TraversalResult | null = LocalGraphTraversalService.traverseLocalSqlite(
    workspaceRoot,
    rootNodeId,
    direction.value,
    10
  );

  if (!result) {
    void vscode.window.showErrorMessage(MSG_GRAPH_TRAVERSAL_FAILED);
    return;
  }

  const traverseChannel = vscode.window.createOutputChannel(MSG_GRAPH_TRAVERSAL_OUTPUT_TITLE);
  traverseChannel.clear();
  traverseChannel.appendLine(
    MSG_GRAPH_TRAVERSAL_HEADER.replace("{0}", result.rootName).replace("{1}", direction.value)
  );
  traverseChannel.appendLine(
    MSG_GRAPH_TRAVERSAL_STATS.replace("{0}", String(result.maxDepth))
      .replace("{1}", String(result.nodes.length))
      .replace("{2}", String(result.edges.length))
  );
  traverseChannel.appendLine("─".repeat(60));

  for (const resultNode of result.nodes) {
    const indent = "  ".repeat(resultNode.depth);
    const prefix =
      resultNode.depth === 0
        ? MSG_GRAPH_TRAVERSAL_NODE_PREFIX_ROOT
        : MSG_GRAPH_TRAVERSAL_NODE_PREFIX_CHILD;
    traverseChannel.appendLine(
      MSG_GRAPH_TRAVERSAL_NODE_LINE.replace("{0}", indent)
        .replace("{1}", prefix)
        .replace("{2}", resultNode.type)
        .replace("{3}", resultNode.name)
        .replace("{4}", String(resultNode.depth))
    );
  }

  if (result.edges.length > 0) {
    traverseChannel.appendLine("");
    traverseChannel.appendLine(MSG_GRAPH_TRAVERSAL_EDGES_TITLE);
    for (const edge of result.edges) {
      traverseChannel.appendLine(
        MSG_GRAPH_TRAVERSAL_EDGE_LINE.replace("{0}", String(edge.sourceNodeId))
          .replace("{1}", edge.linkType)
          .replace("{2}", String(edge.targetNodeId))
      );
    }
  }

  traverseChannel.show(true);
}
