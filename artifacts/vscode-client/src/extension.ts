import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CentralServerAuthError, CentralServerClient } from './CentralServerClient.js';
import { registerDocuviaChatParticipant } from './ChatParticipant.js';
import { CredentialManager } from './CredentialManager.js';
import { DashboardPanel } from './DashboardPanel.js';
import { CodeLensDecisionData, DocuviaCodeLensProvider } from './DocuviaCodeLensProvider.js';
import { DocuviaHoverProvider } from './DocuviaHoverProvider.js';
import { KnowledgeGraphTreeProvider } from './KnowledgeGraphTreeProvider.js';
import { KnowledgeStore } from './KnowledgeStore.js';
import { parseGlobalConfig } from './parser.js';
import { SearchResultsPanel } from './SearchResultsPanel.js';
import { TaskQueueTreeProvider } from './TaskQueueTreeProvider.js';
import { TaskRunner } from './TaskRunner.js';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Docuvia');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('[Docuvia] Extension activating...');

  const store = KnowledgeStore.getInstance(outputChannel);

  // ─── Global Config ────────────────────────────────────────────────────────
  const globalConfigPath = path.join(os.homedir(), '.docuvia', 'config.yaml');
  let globalConfigContent = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(globalConfigPath));
    globalConfigContent = Buffer.from(bytes).toString('utf-8');
  } catch {
    // ignore
  }
  const globalConfig = parseGlobalConfig(globalConfigContent, globalConfigPath);
  store.setGlobalConfig(globalConfig);
  outputChannel.appendLine(
    `[Docuvia] Global config loaded. server_url=${globalConfig.server_url ?? '(none)'}`
  );

  // ─── Credential Manager & Central Server Client ───────────────────────────
  const credentialManager = new CredentialManager(context.secrets);
  const centralClient = new CentralServerClient(store, credentialManager);

  // Load knowledge graph and start watcher
  await store.load();
  store.startWatcher(context);

  // ─── Tree Providers ───────────────────────────────────────────────────────

  const kgProvider = new KnowledgeGraphTreeProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('docuvia.knowledgeGraph', kgProvider)
  );

  const tqProvider = new TaskQueueTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('docuvia.taskQueue', tqProvider)
  );

  // ─── Task Runner ──────────────────────────────────────────────────────────

  const taskRunner = new TaskRunner(tqProvider, outputChannel, store, store.globalConfig ?? undefined);

  // ─── CodeLens Provider ────────────────────────────────────────────────────────

  const codeLensProvider = new DocuviaCodeLensProvider(store, context);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'typescript' },
        { language: 'javascript' },
        { language: 'typescriptreact' },
        { language: 'javascriptreact' },
        { language: 'python' },
      ],
      codeLensProvider
    )
  );

  // ─── Hover Provider ───────────────────────────────────────────────────────────

  const hoverProvider = new DocuviaHoverProvider(store);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [
        { language: 'yaml', pattern: '**/.docuvia/*.yaml' },
        { language: 'markdown', pattern: '**/.docuvia/l3_decisions/*.md' },
      ],
      hoverProvider
    ),
    vscode.languages.registerHoverProvider({ language: 'typescript' }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: 'javascript' }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: 'typescriptreact' }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: 'javascriptreact' }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: 'python' }, hoverProvider)
  );

  // ─── Chat Participant ─────────────────────────────────────────────────────

  const chatParticipant = registerDocuviaChatParticipant(context, store, taskRunner, centralClient);
  context.subscriptions.push(chatParticipant);

  // ─── Commands ─────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.initProject', async () => {
      await initProject(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.refreshKnowledgeGraph', async () => {
      const loaded = await store.load();
      if (loaded) {
        void vscode.window.showInformationMessage('Docuvia: Knowledge graph refreshed.');
      } else {
        void vscode.window.showWarningMessage(
          'Docuvia: No .docuvia/ folder found in this workspace.'
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.addDecision', async () => {
      await addDecision(context, store);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.openDashboard', () => {
      DashboardPanel.createOrShow(context, store, tqProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.runExtraction', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage(
          'Docuvia: Open a file to extract decisions from.'
        );
        return;
      }
      const filePath = editor.document.uri.fsPath;
      const content = editor.document.getText();
      const tokenSource = new vscode.CancellationTokenSource();
      const taskId = await taskRunner.queueExtraction({
        label: `L3 extract: ${path.basename(filePath)}`,
        content,
        sourceFilePath: filePath,
        token: tokenSource.token,
      }).finally(() => tokenSource.dispose());
      void vscode.window.showInformationMessage(
        `Docuvia: Extraction task ${taskId} queued. Check Task Queue panel.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.clearCompletedTasks', () => {
      tqProvider.clearCompleted();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'docuvia.showDecisionsForLens',
      async (data: CodeLensDecisionData) => {
        await showDecisionsForLens(store, data);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.addDecisionFromSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showWarningMessage('Docuvia: Select code first.');
        return;
      }
      const selectedText = editor.document.getText(editor.selection);
      const langId = editor.document.languageId;
      const prefillBody = `\`\`\`${langId}\n${selectedText}\n\`\`\``;
      await addDecision(context, store, prefillBody);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'docuvia.acceptL1Tags',
      async (yamlContent: string) => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;
        const uri = vscode.Uri.file(
          path.join(workspaceRoot, '.docuvia', 'l1_tags.yaml')
        );
        await vscode.workspace.fs.writeFile(uri, Buffer.from(yamlContent, 'utf-8'));
        void vscode.window.showInformationMessage(
          'Docuvia: l1_tags.yaml updated from @docuvia chat.'
        );
      }
    )
  );

  outputChannel.appendLine('[Docuvia] Extension activated successfully.');

  // ─── Phase 5 Commands ─────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.setServerToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Docuvia server API token',
        password: true,
        placeHolder: 'docuvia_token_...',
      });
      if (token && token.trim().length > 0) {
        await credentialManager.setToken(token.trim());
        void vscode.window.showInformationMessage('Docuvia: Server token saved.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.clearServerToken', async () => {
      await credentialManager.clearToken();
      void vscode.window.showInformationMessage('Docuvia: Server token cleared.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.openSearch', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search cross-project knowledge',
        placeHolder: 'e.g. how do other projects handle auth',
      });
      if (!query || query.trim().length === 0) return;
      const q = query.trim();
      try {
        const results = await centralClient.query(q, 20);
        SearchResultsPanel.createOrShow(context, q, results);
      } catch (err) {
        if (err instanceof CentralServerAuthError) {
          void vscode.window.showErrorMessage(
            "Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."
          );
        } else {
          void vscode.window.showErrorMessage(`Docuvia: Search failed — ${String(err)}`);
        }
      }
    })
  );
}

export function deactivate(): void {
  KnowledgeStore.getInstance(outputChannel).dispose();
}

// ─── Init Project ─────────────────────────────────────────────────────────────

async function initProject(_context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage('Docuvia: No workspace folder is open.');
    return;
  }

  const projectName = await vscode.window.showInputBox({
    prompt: 'Enter the name of your project',
    placeHolder: path.basename(workspaceRoot),
    value: path.basename(workspaceRoot)
  });

  if (projectName === undefined) {
    return; // User cancelled
  }

  const docuviaUri = vscode.Uri.file(path.join(workspaceRoot, '.docuvia'));
  const decisionsUri = vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l3_decisions'));

  // Create folder structure
  await vscode.workspace.fs.createDirectory(docuviaUri);
  await vscode.workspace.fs.createDirectory(decisionsUri);

  // Write skeleton YAML files
  await writeIfAbsent(
    vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l1_tags.yaml')),
    `# L1 Tags — top-level knowledge categories\n# project_name: ${projectName}\nproject_name: "${projectName}"\ntags:\n# - id: <uuid>\n#   slug: <human-readable>\n#   name: <display name>\n#   description: <optional>\n`
  );

  await writeIfAbsent(
    vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l2_modules.yaml')),
    `# L2 Modules — functional subsystems, linked to an L1 tag\n# - id: <uuid>\n#   slug: <human-readable>\n#   name: <display name>\n#   l1_tag_id: <L1 tag id>\n#   source_paths: []\n`
  );

  await writeIfAbsent(
    vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l3_router.yaml')),
    `# L3 Router — performance index of all L3 decisions\n# - id: <uuid>\n#   l2_module_id: <L2 module id>\n#   slug: <human-readable>\n#   title: <decision title>\n#   file_path: l3_decisions/<slug>.md\n`
  );

  // Trigger reload to update state and hide welcome view
  const store = KnowledgeStore.getInstance(outputChannel);
  await store.load();

  void vscode.window.showInformationMessage(
    `Docuvia: Project "${projectName}" initialized. Populate the YAML files to build your knowledge graph.`
  );
}

// ─── Add Decision ─────────────────────────────────────────────────────────────

async function addDecision(
  _context: vscode.ExtensionContext,
  store: KnowledgeStore,
  prefillBody?: string
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage('Docuvia: No workspace folder is open.');
    return;
  }

  const { v4: uuidv4 } = await import('uuid');

  const title = await vscode.window.showInputBox({ prompt: 'Decision title' });
  if (!title) return;

  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const id = uuidv4();
  const date = new Date().toISOString().slice(0, 10);

  const modules = store.snapshot?.modules ?? [];
  if (modules.length === 0) {
    void vscode.window.showWarningMessage(
      'Docuvia: No L2 modules found. Add modules to l2_modules.yaml first.'
    );
    return;
  }

  const moduleItems = modules.map(m => ({ label: m.name, description: m.slug, id: m.id }));
  const picked = await vscode.window.showQuickPick(moduleItems, { placeHolder: 'Select L2 module' });
  if (!picked) return;

  const frontmatter = [
    '---',
    `id: "${id}"`,
    `l2_module_id: "${picked.id}"`,
    `title: "${title}"`,
    `date: "${date}"`,
    `status: "proposed"`,
    '---',
  ].join('\n');

  const bodySection = prefillBody
    ? `## Context\n\n${prefillBody}\n\n## Decision\n\n<!-- What was decided? -->\n\n## Consequences\n\n<!-- What are the trade-offs? -->\n`
    : `## Context\n\n<!-- Why is this decision needed? -->\n\n## Decision\n\n<!-- What was decided? -->\n\n## Consequences\n\n<!-- What are the trade-offs? -->\n`;

  const template = `${frontmatter}\n\n${bodySection}`;

  const filePath = path.join(workspaceRoot, '.docuvia', 'l3_decisions', `${slug}.md`);
  const fileUri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(template, 'utf-8'));

  // Ensure knowledge store is immediately synced after writing
  await store.load();

  const doc = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(doc);
}

// ─── Show Decisions For Lens ─────────────────────────────────────────────────

async function showDecisionsForLens(
  store: KnowledgeStore,
  data: CodeLensDecisionData
): Promise<void> {
  const snapshot = store.snapshot;
  if (!snapshot) return;

  const MAX_INLINE = 2;
  const allIds = data.decisionIds;
  const topIds = allIds.slice(0, MAX_INLINE);

  type QuickPickItem = vscode.QuickPickItem & { decisionId?: string; viewAll?: boolean };

  const items: QuickPickItem[] = topIds.map(id => {
    const decision = snapshot.decisions.get(id);
    return {
      label: decision?.title ?? id,
      description: decision?.status,
      decisionId: id,
    };
  });

  if (allIds.length > MAX_INLINE) {
    items.push({
      label: '$(comment-discussion) View all in Chat',
      description: `${allIds.length} decisions — open @docuvia /query`,
      viewAll: true,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Decisions for module: ${data.moduleName}`,
  });
  if (!picked) return;

  if ((picked as QuickPickItem).viewAll) {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: `@docuvia /query ${data.moduleName}`,
    });
    return;
  }

  const decisionId = (picked as QuickPickItem).decisionId;
  if (decisionId) {
    const decision = snapshot.decisions.get(decisionId);
    if (decision?.filePath) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(decision.filePath));
      await vscode.window.showTextDocument(doc);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function writeIfAbsent(uri: vscode.Uri, content: string): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
    // File already exists — skip
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
  }
}
