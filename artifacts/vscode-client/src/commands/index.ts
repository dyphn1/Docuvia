import * as vscode from "vscode";
import { CredentialManager } from "../credential-manager.js";
import { KnowledgeGraphTreeProvider } from "../knowledge-graph-tree-provider.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";
import {
  MSG_EXTENSION_ACTIVATED_SUCCESS,
  CMD_START_EXPLORE,
  CMD_INIT_PROJECT,
  CMD_AUTO_CATEGORIZE_DECISIONS,
  CMD_REFRESH_KNOWLEDGE_GRAPH,
  CMD_ADD_DECISION,
  CMD_OPEN_DASHBOARD,
  CMD_RUN_EXTRACTION,
  CMD_CLEAR_COMPLETED_TASKS,
  CMD_SHOW_DECISIONS_FOR_LENS,
  CMD_ADD_DECISION_FROM_SELECTION,
  CMD_OPEN_DECISION,
  CMD_ACCEPT_L1_TAGS,
  CMD_CLEAN,
  CMD_STATUS,
  CMD_DETECT_CHANGES,
  CMD_SYNC,
  CMD_SET_SERVER_TOKEN,
  CMD_CLEAR_SERVER_TOKEN,
  CMD_OPEN_SEARCH,
  CMD_SEARCH_FROM_SELECTION,
  CMD_GRAPH_TRAVERSE,
} from "../constants/index.js";

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
  credentialManager: CredentialManager,
  kgProvider: KnowledgeGraphTreeProvider,
  tqProvider: TaskQueueTreeProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_START_EXPLORE, startExploreCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_INIT_PROJECT, (node?: any) =>
      initProjectCommand(context, node)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_AUTO_CATEGORIZE_DECISIONS, (node?: any) =>
      autoCategorizeDecisionsCommand(kgProvider, node)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_REFRESH_KNOWLEDGE_GRAPH, () =>
      refreshKnowledgeGraphCommand()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_ADD_DECISION, () => addDecisionCommand(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_OPEN_DASHBOARD, (node?: any) =>
      openDashboardCommand(context, tqProvider, node)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_EXTRACTION, () => runExtractionCommand(tqProvider))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_CLEAR_COMPLETED_TASKS, () =>
      clearCompletedTasksCommand(tqProvider)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_SHOW_DECISIONS_FOR_LENS, (data: any) =>
      showDecisionsForLensCommand(data)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_ADD_DECISION_FROM_SELECTION, () =>
      addDecisionFromSelectionCommand(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_OPEN_DECISION, (filePath: string) =>
      openDecisionCommand(filePath)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD_ACCEPT_L1_TAGS,
      (yamlContent: string, explicitRoot: string) => acceptL1TagsCommand(yamlContent, explicitRoot)
    )
  );

  outputChannel.appendLine(MSG_EXTENSION_ACTIVATED_SUCCESS);

  // ─── Phase 5 Commands ─────────────────────────────────────────────────────

  context.subscriptions.push(vscode.commands.registerCommand(CMD_CLEAN, cleanCommand));

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_STATUS, () => statusCommand(outputChannel))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_DETECT_CHANGES, () => detectChangesCommand(outputChannel))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_SYNC, () => syncCommand(outputChannel, credentialManager))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_SET_SERVER_TOKEN, () =>
      setServerTokenCommand(credentialManager)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_CLEAR_SERVER_TOKEN, () =>
      clearServerTokenCommand(credentialManager)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_OPEN_SEARCH, () => openSearchCommand(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_SEARCH_FROM_SELECTION, () =>
      searchFromSelectionCommand(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_GRAPH_TRAVERSE, (node?: any) =>
      traverseGraphCommand(outputChannel, node)
    )
  );
}
