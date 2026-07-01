import * as path from "path";
import * as vscode from "vscode";
import { CentralServerClient } from "./central-server-client.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { TaskRunner } from "./task-runner.js";
import { handleExplore } from "./chat/handlers/explore.js";
import { handleQuery } from "./chat/handlers/query.js";
import { handleExtract } from "./chat/handlers/extract.js";
import { handleHelp } from "./chat/handlers/help.js";

export function registerDocuviaChatParticipant(
  context: vscode.ExtensionContext,
  store: KnowledgeStore,
  taskRunner: TaskRunner,
  centralClient: CentralServerClient
): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
    const cmd = request.command;
    if (cmd === "explore" || (!cmd && request.prompt.toLowerCase().includes("explore"))) {
      return handleExplore(request, stream, token, request.prompt);
    }
    switch (cmd) {
      case "query":
        return handleQuery(request, stream, store, centralClient);
      case "extract":
        return handleExtract(request, stream, token, taskRunner);
      case "help":
      default:
        return handleHelp(stream);
    }
  };

  const participant = vscode.chat.createChatParticipant("docuvia.assistant", handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "icon.svg");

  participant.followupProvider = {
    provideFollowups: async (_result, _context, _token) => {
      const folders = vscode.workspace.workspaceFolders || [];
      if (folders.length === 0) {
        return [];
      }
      for (const folder of folders) {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(path.join(folder.uri.fsPath, ".docuvia")));
        } catch {
          return [{ prompt: "/explore", label: "Explore this project and suggest L1 tags" }];
        }
      }
      return [];
    },
  };

  return participant;
}
