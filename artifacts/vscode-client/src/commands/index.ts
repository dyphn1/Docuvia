import * as vscode from "vscode";
import { CentralServerClient } from "../central-server-client.js";
import { CredentialManager } from "../credential-manager.js";
import { KnowledgeGraphTreeProvider } from "../knowledge-graph-tree-provider.js";
import { KnowledgeStore } from "../knowledge-store.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";
import { TaskRunner } from "../task-runner.js";

import { startExploreCommand } from "./explore.js";
import { initProjectCommand } from "./init-project.js";
import {
  autoCategorizeDecisionsCommand,
  addDecisionCommand,
  addDecisionFromSelectionCommand,
  openDecisionCommand,
  showDecisionsForLensCommand,
} from "./decision.js";
import { refreshKnowledgeGraphCommand, traverseGraphCommand } from "./graph.js";
import { openDashboardCommand } from "./dashboard.js";
import { runExtractionCommand } from "./extraction.js";
import { clearCompletedTasksCommand } from "./tasks.js";
import { acceptL1TagsCommand } from "./tags.js";
import { cleanCommand, statusCommand, detectChangesCommand, syncCommand } from "./workspace.js";
import { setServerTokenCommand, clearServerTokenCommand } from "./auth.js";
import { openSearchCommand, searchFromSelectionCommand } from "./search.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  store: KnowledgeStore,
  taskRunner: TaskRunner,
  centralClient: CentralServerClient,
  credentialManager: CredentialManager,
  kgProvider: KnowledgeGraphTreeProvider,
  tqProvider: TaskQueueTreeProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.startExplore", startExploreCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.initProject", (node?: any) =>
      initProjectCommand(context, store, centralClient, node)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.autoCategorizeDecisions", (node?: any) =>
      autoCategorizeDecisionsCommand(kgProvider, taskRunner, node)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.refreshKnowledgeGraph", () =>
      refreshKnowledgeGraphCommand(store)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.addDecision", () => addDecisionCommand(context, store))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.openDashboard", (node?: any) =>
      openDashboardCommand(context, store, tqProvider, node)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.runExtraction", () => runExtractionCommand(taskRunner))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.clearCompletedTasks", () =>
      clearCompletedTasksCommand(tqProvider)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.showDecisionsForLens", (data: any) =>
      showDecisionsForLensCommand(store, data)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.addDecisionFromSelection", () =>
      addDecisionFromSelectionCommand(context, store)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.openDecision", (filePath: string) =>
      openDecisionCommand(filePath)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "docuvia.acceptL1Tags",
      (yamlContent: string, explicitRoot: string) =>
        acceptL1TagsCommand(store, yamlContent, explicitRoot)
    )
  );

  outputChannel.appendLine("[Docuvia] Extension activated successfully.");

  // ─── Phase 5 Commands ─────────────────────────────────────────────────────

  context.subscriptions.push(vscode.commands.registerCommand("docuvia.clean", cleanCommand));

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.status", () => statusCommand(outputChannel))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.detectChanges", () =>
      detectChangesCommand(outputChannel)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.sync", () =>
      syncCommand(outputChannel, store, credentialManager)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.setServerToken", () =>
      setServerTokenCommand(credentialManager)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.clearServerToken", () =>
      clearServerTokenCommand(credentialManager)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.openSearch", () =>
      openSearchCommand(context, centralClient)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.searchFromSelection", () =>
      searchFromSelectionCommand(context, centralClient)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.graph.traverse", (node?: any) =>
      traverseGraphCommand(outputChannel, node)
    )
  );
}
