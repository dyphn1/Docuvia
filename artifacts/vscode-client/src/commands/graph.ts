import * as vscode from "vscode";
import * as path from "path";
import { KGNode } from "../knowledge-graph-tree-provider.js";
import { KnowledgeStore, TraversalResult } from "../knowledge-store.js";

export async function refreshKnowledgeGraphCommand(store: KnowledgeStore) {
  const loaded = await store.load();
  if (loaded) {
    void vscode.window.showInformationMessage("Docuvia: Knowledge graph refreshed.");
  } else {
    void vscode.window.showWarningMessage("Docuvia: No .docuvia/ folder found in this workspace.");
  }
}

export async function traverseGraphCommand(outputChannel: vscode.OutputChannel, node?: KGNode) {
  const store = KnowledgeStore.getInstance(outputChannel);
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage(
      "Docuvia: Open a workspace folder to traverse the knowledge graph."
    );
    return;
  }

  let rootNodeId: number | undefined;
  if (node && node.kind === "l2module" && node.workspaceRoot) {
    rootNodeId = Number(node.id);
  } else {
    const items: vscode.QuickPickItem[] = [];
    for (const folder of folders) {
      const snap = store.getSnapshotFor(folder.uri.fsPath);
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
      void vscode.window.showWarningMessage(
        "Docuvia: No knowledge graph modules found. Run indexing first."
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a module to traverse its dependency graph",
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
        description: "What this module depends on",
        value: "dependencies",
      },
      {
        label: "$(arrow-up) Dependents (Impact)",
        description: "What depends on this module",
        value: "dependents",
      },
      {
        label: "$(arrow-both) Both Directions",
        description: "Full dependency graph",
        value: "both",
      },
    ],
    { placeHolder: "Traversal direction" }
  );
  if (!direction) return;

  let workspaceRoot: string | undefined;
  for (const folder of folders) {
    const snap = store.getSnapshotFor(folder.uri.fsPath);
    if (snap?.modules.find((m) => Number(m.id) === rootNodeId)) {
      workspaceRoot = folder.uri.fsPath;
      break;
    }
  }
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Docuvia: Could not find workspace for selected module.");
    return;
  }

  const result: TraversalResult = store.traverseGraph(
    workspaceRoot,
    rootNodeId,
    direction.value,
    10
  );

  const traverseChannel = vscode.window.createOutputChannel("Docuvia Graph Traversal");
  traverseChannel.clear();
  traverseChannel.appendLine(`Graph Traversal: ${result.rootName} (${direction.value})`);
  traverseChannel.appendLine(
    `Depth: ${result.maxDepth} | Nodes: ${result.nodes.length} | Edges: ${result.edges.length}`
  );
  traverseChannel.appendLine("─".repeat(60));

  for (const resultNode of result.nodes) {
    const indent = "  ".repeat(resultNode.depth);
    const prefix = resultNode.depth === 0 ? "●" : "└→";
    traverseChannel.appendLine(
      `${indent}${prefix} [${resultNode.type}] ${resultNode.name} (depth ${resultNode.depth})`
    );
  }

  if (result.edges.length > 0) {
    traverseChannel.appendLine("");
    traverseChannel.appendLine("Edges:");
    for (const edge of result.edges) {
      traverseChannel.appendLine(
        `  ${edge.sourceNodeId} ──[${edge.linkType}]──▶ ${edge.targetNodeId}`
      );
    }
  }

  traverseChannel.show(true);
}
