import * as path from "path";
import * as vscode from "vscode";
import { handleExplore } from "./chat/handlers/explore.js";
import { handleQuery } from "./chat/handlers/query.js";
import { handleExtract } from "./chat/handlers/extract.js";
import { handleHelp } from "./chat/handlers/help.js";
import { TaskQueueTreeProvider } from "./task-queue-tree-provider.js";
import { DOCUVIA_DIR_NAME } from "@workspace/core";
import {
  MSG_CHAT_ERROR,
  MSG_CHAT_FOLLOWUP_EXPLORE_PROMPT,
  MSG_CHAT_FOLLOWUP_EXPLORE_LABEL,
} from "./constants/index.js";

export function registerDocuviaChatParticipant(
  context: vscode.ExtensionContext,
  tqProvider?: TaskQueueTreeProvider
): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
    try {
      const cmd = request.command;
      if (cmd === "explore" || (!cmd && request.prompt.toLowerCase().includes("explore"))) {
        return await handleExplore(request, stream, token, request.prompt);
      }
      switch (cmd) {
        case "query":
          return await handleQuery(request, stream);
        case "extract":
          return await handleExtract(request, stream, token, tqProvider);
        case "help":
        default:
          return await handleHelp(stream);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[ChatParticipant] Unhandled error:", err);
      stream.markdown(`${MSG_CHAT_ERROR}${errorMsg}`);
      return { errorDetails: { message: errorMsg } };
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
          await vscode.workspace.fs.stat(
            vscode.Uri.file(path.join(folder.uri.fsPath, DOCUVIA_DIR_NAME))
          );
        } catch {
          return [
            { prompt: MSG_CHAT_FOLLOWUP_EXPLORE_PROMPT, label: MSG_CHAT_FOLLOWUP_EXPLORE_LABEL },
          ];
        }
      }
      return [];
    },
  };

  return participant;
}
