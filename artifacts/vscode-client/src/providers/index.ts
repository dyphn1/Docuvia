import * as vscode from "vscode";
import { DocuviaCodeLensProvider } from "../docuvia-code-lens-provider.js";
import { DocuviaHoverProvider } from "../docuvia-hover-provider.js";
import { KnowledgeGraphTreeProvider } from "../knowledge-graph-tree-provider.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";
import { DOCUVIA_DIR_NAME, DIR_L3_DECISIONS } from "@workspace/core";
import {
  VIEW_KNOWLEDGE_GRAPH,
  VIEW_TASK_QUEUE,
  SUPPORTED_CODE_LANGUAGES,
  LANG_MARKDOWN,
} from "../constants/index.js";

export function registerProviders(
  context: vscode.ExtensionContext,
  kgProvider: KnowledgeGraphTreeProvider,
  tqProvider: TaskQueueTreeProvider
): void {
  // Tree Providers
  const kgTreeView = vscode.window.createTreeView(VIEW_KNOWLEDGE_GRAPH, {
    treeDataProvider: kgProvider,
    dragAndDropController: kgProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(kgTreeView);

  context.subscriptions.push(vscode.window.registerTreeDataProvider(VIEW_TASK_QUEUE, tqProvider));

  // CodeLens Provider
  const codeLensProvider = new DocuviaCodeLensProvider(context);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(SUPPORTED_CODE_LANGUAGES, codeLensProvider)
  );

  // Hover Provider
  const hoverProvider = new DocuviaHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ language: LANG_MARKDOWN, pattern: `**/${DOCUVIA_DIR_NAME}/${DIR_L3_DECISIONS}/*.md` }],
      hoverProvider
    ),
    ...SUPPORTED_CODE_LANGUAGES.map((lang) =>
      vscode.languages.registerHoverProvider(lang, hoverProvider)
    )
  );
}
