import * as vscode from "vscode";

// ─── Command Name Constants ───────────────────────────────────────────────

export const CMD_START_EXPLORE = "docuvia.startExplore";
export const CMD_INIT_PROJECT = "docuvia.initProject";
export const CMD_AUTO_CATEGORIZE_DECISIONS = "docuvia.autoCategorizeDecisions";
export const CMD_REFRESH_KNOWLEDGE_GRAPH = "docuvia.refreshKnowledgeGraph";
export const CMD_ADD_DECISION = "docuvia.addDecision";
export const CMD_OPEN_DASHBOARD = "docuvia.openDashboard";
export const CMD_RUN_EXTRACTION = "docuvia.runExtraction";
export const CMD_CLEAR_COMPLETED_TASKS = "docuvia.clearCompletedTasks";
export const CMD_SHOW_DECISIONS_FOR_LENS = "docuvia.showDecisionsForLens";
export const CMD_ADD_DECISION_FROM_SELECTION = "docuvia.addDecisionFromSelection";
export const CMD_OPEN_DECISION = "docuvia.openDecision";
export const CMD_ACCEPT_L1_TAGS = "docuvia.acceptL1Tags";
export const CMD_CLEAN = "docuvia.clean";
export const CMD_STATUS = "docuvia.status";
export const CMD_DETECT_CHANGES = "docuvia.detectChanges";
export const CMD_SYNC = "docuvia.sync";
export const CMD_SET_SERVER_TOKEN = "docuvia.setServerToken";
export const CMD_CLEAR_SERVER_TOKEN = "docuvia.clearServerToken";
export const CMD_OPEN_SEARCH = "docuvia.openSearch";
export const CMD_SEARCH_FROM_SELECTION = "docuvia.searchFromSelection";
export const CMD_GRAPH_TRAVERSE = "docuvia.graph.traverse";

// Built-in VS Code commands and contexts used
export const CMD_VSCODE_CHAT_OPEN = "workbench.action.chat.open";
export const CMD_VSCODE_SET_CONTEXT = "setContext";
export const CMD_VSCODE_EXECUTE_DOCUMENT_SYMBOL_PROVIDER = "vscode.executeDocumentSymbolProvider";
export const CONTEXT_IS_INITIALIZED = "docuvia:isInitialized";
export const CONTEXT_HAS_DIRTY_FILES = "docuvia.hasDirtyFiles";

// (Legacy alias often used synonymously with CMD_REFRESH_KNOWLEDGE_GRAPH)
export const CMD_KNOWLEDGE_GRAPH_REFRESH = "docuvia.knowledgeGraph.refresh";

// ─── Command Invoker Object ───────────────────────────────────────────────

export const DocuviaCommandInvoker = {
  executeOpenDecision: async (filePath: string) => {
    return vscode.commands.executeCommand(CMD_OPEN_DECISION, filePath);
  },
  executeRefreshKnowledgeGraph: async () => {
    return vscode.commands.executeCommand(CMD_KNOWLEDGE_GRAPH_REFRESH);
  },
  executeChatOpen: async (query: string) => {
    return vscode.commands.executeCommand(CMD_VSCODE_CHAT_OPEN, { query });
  },
  executeSetContext: async (contextKey: string, value: boolean) => {
    return vscode.commands.executeCommand(CMD_VSCODE_SET_CONTEXT, contextKey, value);
  },
  executeDocumentSymbolProvider: async (uri: vscode.Uri) => {
    return vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      CMD_VSCODE_EXECUTE_DOCUMENT_SYMBOL_PROVIDER,
      uri
    );
  },
};
