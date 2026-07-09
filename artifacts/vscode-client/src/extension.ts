import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { registerDocuviaChatParticipant } from "./chat-participant.js";
import { CredentialManager } from "./credential-manager.js";
import { parseGlobalConfig } from "./parser.js";
import { registerCommands } from "./commands/index.js";
import { registerProviders } from "./providers/index.js";
import { KnowledgeGraphTreeProvider } from "./knowledge-graph-tree-provider.js";
import { TaskQueueTreeProvider } from "./task-queue-tree-provider.js";
import {
  shutdownGlobalWorkerPool,
  DOCUVIA_DIR_NAME,
  FILE_GLOBAL_CONFIG_YAML,
  ENCODING_UTF_8,
} from "@workspace/core";
import { registerVfsWatcher } from "./vfs-watcher.js";
import {
  MSG_EXTENSION_NAME,
  MSG_EXTENSION_ACTIVATING,
  MSG_EXTENSION_CONFIG_LOADED,
  MSG_EXTENSION_CONFIG_NONE,
} from "./constants/index.js";

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel(MSG_EXTENSION_NAME);
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine(MSG_EXTENSION_ACTIVATING);

  registerVfsWatcher(context);

  // ─── Global Config ────────────────────────────────────────────────────────
  const globalConfigPath = path.join(os.homedir(), DOCUVIA_DIR_NAME, FILE_GLOBAL_CONFIG_YAML);
  let globalConfigContent = "";
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(globalConfigPath));
    globalConfigContent = Buffer.from(bytes).toString(ENCODING_UTF_8);
  } catch {
    // ignore
  }
  const globalConfig = parseGlobalConfig(globalConfigContent, globalConfigPath);
  outputChannel.appendLine(
    `${MSG_EXTENSION_CONFIG_LOADED}${globalConfig.server_url ?? MSG_EXTENSION_CONFIG_NONE}`
  );

  // ─── Credential Manager ───────────────────────────────────────────────────
  const credentialManager = new CredentialManager(context.secrets);

  // ─── Providers ────────────────────────────────────────────────────────────
  const kgProvider = new KnowledgeGraphTreeProvider();
  const tqProvider = new TaskQueueTreeProvider();

  registerProviders(context, kgProvider, tqProvider);

  const chatParticipant = registerDocuviaChatParticipant(context, tqProvider);
  context.subscriptions.push(chatParticipant);

  registerCommands(context, outputChannel, credentialManager, kgProvider, tqProvider);
}

export async function deactivate(): Promise<void> {
  // Terminate the module-level AST worker pool singleton so repeated activate/deactivate
  // cycles in a long-lived host don't leak worker threads (Issue 1.10).
  await shutdownGlobalWorkerPool();
}
