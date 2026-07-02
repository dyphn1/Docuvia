import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { CentralServerClient } from "./central-server-client.js";
import { registerDocuviaChatParticipant } from "./chat-participant.js";
import { CredentialManager } from "./credential-manager.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { parseGlobalConfig } from "./parser.js";
import { TaskRunner } from "./task-runner.js";
import { registerCommands } from "./commands/index.js";
import { registerProviders } from "./providers/index.js";
import { KnowledgeGraphTreeProvider } from "./knowledge-graph-tree-provider.js";
import { TaskQueueTreeProvider } from "./task-queue-tree-provider.js";
import { AstWatcher } from "./indexer/ast-watcher.js";

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("Docuvia");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("[Docuvia] Extension activating...");

  const store = KnowledgeStore.getInstance(outputChannel);

  // ─── Global Config ────────────────────────────────────────────────────────
  const globalConfigPath = path.join(os.homedir(), ".docuvia", "config.yaml");
  let globalConfigContent = "";
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(globalConfigPath));
    globalConfigContent = Buffer.from(bytes).toString("utf-8");
  } catch {
    // ignore
  }
  const globalConfig = parseGlobalConfig(globalConfigContent, globalConfigPath);
  store.setGlobalConfig(globalConfig);
  outputChannel.appendLine(
    `[Docuvia] Global config loaded. server_url=${globalConfig.server_url ?? "(none)"}`
  );

  // ─── Credential Manager & Central Server Client ───────────────────────────
  const credentialManager = new CredentialManager(context.secrets);
  const centralClient = new CentralServerClient(store, credentialManager);
  centralClient.startHeartbeat();
  store.setCentralClient(centralClient);

  // Load knowledge graph and start watcher
  await store.load();
  store.startWatcher(context);

  // Start fast-path AST watcher
  const astWatcher = new AstWatcher(outputChannel);
  context.subscriptions.push(astWatcher);

  // ─── Providers and Task Runner ────────────────────────────────────────────
  const kgProvider = new KnowledgeGraphTreeProvider(store);
  const tqProvider = new TaskQueueTreeProvider();

  const taskRunner = new TaskRunner(
    tqProvider,
    outputChannel,
    store,
    store.globalConfig ?? undefined
  );

  registerProviders(context, store, kgProvider, tqProvider);

  const chatParticipant = registerDocuviaChatParticipant(context, store, taskRunner, centralClient);
  context.subscriptions.push(chatParticipant);

  registerCommands(
    context,
    outputChannel,
    store,
    taskRunner,
    centralClient,
    credentialManager,
    kgProvider,
    tqProvider
  );
}

export function deactivate(): void {
  KnowledgeStore.getInstance(outputChannel).dispose();
}
