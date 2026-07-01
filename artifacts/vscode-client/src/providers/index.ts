import * as vscode from "vscode";
import { DocuviaCodeLensProvider } from "../docuvia-code-lens-provider.js";
import { DocuviaHoverProvider } from "../docuvia-hover-provider.js";
import { KnowledgeIndexer } from "../indexer/knowledge-indexer.js";
import { KnowledgeGraphTreeProvider } from "../knowledge-graph-tree-provider.js";
import { KnowledgeStore } from "../knowledge-store.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";

export function registerProviders(
  context: vscode.ExtensionContext,
  store: KnowledgeStore,
  kgProvider: KnowledgeGraphTreeProvider,
  tqProvider: TaskQueueTreeProvider
): void {
  // Tree Providers
  const kgTreeView = vscode.window.createTreeView("docuvia.knowledgeGraph", {
    treeDataProvider: kgProvider,
    dragAndDropController: kgProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(kgTreeView);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("docuvia.taskQueue", tqProvider)
  );

  // CodeLens Provider
  const codeLensProvider = new DocuviaCodeLensProvider(store, context);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "typescript" },
        { language: "javascript" },
        { language: "typescriptreact" },
        { language: "javascriptreact" },
        { language: "python" },
      ],
      codeLensProvider
    )
  );

  // Knowledge Indexer
  const indexer = new KnowledgeIndexer(store);
  context.subscriptions.push(indexer);

  // Hover Provider
  const hoverProvider = new DocuviaHoverProvider(store, indexer);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ language: "markdown", pattern: "**/.docuvia/l3_decisions/*.md" }],
      hoverProvider
    ),
    vscode.languages.registerHoverProvider({ language: "typescript" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "javascript" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "typescriptreact" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "javascriptreact" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "python" }, hoverProvider)
  );
}
