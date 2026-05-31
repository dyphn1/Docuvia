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
import { minimatch } from 'minimatch';

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
  store.setCentralClient(centralClient);

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
    vscode.commands.registerCommand('docuvia.startExplore', async () => {
      // Open the Copilot Chat view with the explore command pre-filled and executed
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: '@docuvia /explore' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.initProject', async (node?: any) => {
      await initProject(context, store, node);
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
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const relativePath = workspaceFolder 
        ? path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, '/')
        : path.basename(filePath);

      const config = vscode.workspace.getConfiguration('docuvia');
      const includePatterns = config.get<string[]>('extraction.includePatterns', []);
      const maxLines = config.get<number>('extraction.maxLinesWarning', 1000);

      // Check against include patterns (like .gitignore check)
      const isIncluded = includePatterns.some(pattern => minimatch(relativePath, pattern));
      if (!isIncluded) {
        const proceed = await vscode.window.showWarningMessage(
          `Docuvia: This file type (${path.basename(filePath)}) is not in your include list. Analyze it anyway?`,
          'Yes', 'No'
        );
        if (proceed !== 'Yes') return;
      }

      // Check line count limit
      const lineCount = editor.document.lineCount;
      if (lineCount > maxLines) {
        const proceed = await vscode.window.showWarningMessage(
          `Docuvia: This file is very large (${lineCount} lines). Analyzing the entire file might be slow and consume many tokens. We recommend selecting a specific block and using right-click "Docuvia: Add Decision from Selection". Proceed anyway?`,
          'Proceed', 'Cancel'
        );
        if (proceed !== 'Proceed') return;
      }

      // Check KB size limit
      const maxKB = config.get<number>('extraction.maxFileSizeKBWarning', 50);
      const fileSizeKB = Buffer.byteLength(editor.document.getText(), 'utf-8') / 1024;
      if (fileSizeKB > maxKB) {
        const proceed = await vscode.window.showWarningMessage(
          `Docuvia: This file is large (${fileSizeKB.toFixed(1)} KB). Extraction might be slow. Proceed anyway?`,
          'Proceed', 'Cancel'
        );
        if (proceed !== 'Proceed') return;
      }

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
    vscode.commands.registerCommand('docuvia.openDecision', async (filePath: string) => {
      if (!filePath) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'docuvia.acceptL1Tags',
      // BUG A-3 fix: accept explicit workspaceRoot from ChatParticipant; fall back to [0] only when absent
      async (yamlContent: string, explicitRoot?: string) => {
        const workspaceRoot = explicitRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;

        const docuviaUri = vscode.Uri.file(path.join(workspaceRoot, '.docuvia'));
        const decisionsUri = vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l3_decisions'));

        // BUG A-1 fix: create .docuvia/ directory before writing
        await vscode.workspace.fs.createDirectory(docuviaUri);
        await vscode.workspace.fs.createDirectory(decisionsUri);

        // Write l1_tags.yaml
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l1_tags.yaml')),
          Buffer.from(yamlContent, 'utf-8')
        );

        // BUG A-2 fix: ensure l2_modules.yaml and l3_router.yaml skeleton exist
        await writeIfAbsent(
          vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l2_modules.yaml')),
          `# L2 Modules — functional subsystems, linked to an L1 tag\n# - id: <uuid>\n#   slug: <human-readable>\n#   name: <display name>\n#   l1_tag_id: <L1 tag id>\n#   source_paths: []\n`
        );
        await writeIfAbsent(
          vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l3_router.yaml')),
          `# L3 Router — performance index of all L3 decisions\n# - id: <uuid>\n#   l2_module_id: <L2 module id>\n#   slug: <human-readable>\n#   title: <decision title>\n#   file_path: l3_decisions/<slug>.md\n`
        );

        await store.load();
        void vscode.window.showInformationMessage(
          'Docuvia: l1_tags.yaml written and knowledge graph initialized.'
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
        validateInput: (v) => v.trim().length === 0 ? 'Token cannot be empty' : null,
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
      await executeSearch(context, centralClient, query.trim());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docuvia.searchFromSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showWarningMessage('Docuvia: Select code or text to search.');
        return;
      }
      // BUG N-2 fix: cap query length to 2000 chars to prevent sending entire files to server
      const MAX_QUERY_LENGTH = 2000;
      const rawText = editor.document.getText(editor.selection).trim();
      const selectedText = rawText.length > MAX_QUERY_LENGTH
        ? rawText.slice(0, MAX_QUERY_LENGTH)
        : rawText;
      if (rawText.length > MAX_QUERY_LENGTH) {
        void vscode.window.showWarningMessage(
          `Docuvia: Selection was too long (${rawText.length} chars) and was truncated to ${MAX_QUERY_LENGTH} chars for search.`
        );
      }
      await executeSearch(context, centralClient, selectedText);
    })
  );
}

async function executeSearch(context: vscode.ExtensionContext, centralClient: CentralServerClient, query: string) {
  try {
    const config = vscode.workspace.getConfiguration('docuvia');
    const viewPref = config.get<string>('search.defaultView', 'chat');

    if (viewPref === 'chat') {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@docuvia /query ${query}`
      });
    } else {
      const results = await centralClient.query(query, 20);
      SearchResultsPanel.createOrShow(context, query, results);
    }
  } catch (err) {
    if (err instanceof CentralServerAuthError) {
      void vscode.window.showErrorMessage(
        "Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."
      );
    } else {
      void vscode.window.showErrorMessage(`Docuvia: Search failed — ${String(err)}`);
    }
  }
}

export function deactivate(): void {
  KnowledgeStore.getInstance(outputChannel).dispose();
}

// ─── Init Project ─────────────────────────────────────────────────────────────

async function initProject(_context: vscode.ExtensionContext, store: KnowledgeStore, node?: any): Promise<void> {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage('Docuvia: No workspace folder is open.');
    return;
  }

  let targetRoot: string | undefined;

  // If triggered from the TreeView inline action
  if (node && node.workspaceRoot) {
    targetRoot = node.workspaceRoot;
  } else if (folders.length === 1) {
    targetRoot = folders[0].uri.fsPath;
  } else {
    // Multi-root, ask the user to pick one that is not yet initialized
    const uninitialized = folders.filter(f => !store.snapshots.has(f.uri.fsPath));
    if (uninitialized.length === 0) {
      void vscode.window.showInformationMessage('Docuvia: All workspace folders are already initialized.');
      return;
    }
    
    const picks = uninitialized.map(f => ({ label: f.name, description: f.uri.fsPath, fsPath: f.uri.fsPath }));
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select a workspace folder to initialize Docuvia in',
    });
    
    if (!picked) return;
    targetRoot = picked.fsPath;
  }

  if (!targetRoot) return;

  // If the project is already initialized, prompt for force-overwrite
  const isAlreadyInitialized = store.snapshots.has(targetRoot);
  if (isAlreadyInitialized) {
    const name = path.basename(targetRoot);
    const choice = await vscode.window.showWarningMessage(
      `Docuvia: "${name}" is already initialized. Overwrite existing config files? This action cannot be undone.`,
      'Overwrite',
      'Cancel'
    );
    if (choice !== 'Overwrite') return;
  }

  // BUG G-1 fix: validate that project name is not empty
  const projectName = await vscode.window.showInputBox({
    prompt: 'Enter the name of your project',
    placeHolder: path.basename(targetRoot),
    value: path.basename(targetRoot),
    validateInput: (v) => v.trim().length === 0 ? 'Project name cannot be empty' : null,
  });

  if (projectName === undefined || projectName.trim().length === 0) {
    return; // User cancelled or submitted empty
  }

  const docuviaUri = vscode.Uri.file(path.join(targetRoot, '.docuvia'));
  const decisionsUri = vscode.Uri.file(path.join(targetRoot, '.docuvia', 'l3_decisions'));

  // Create folder structure
  await vscode.workspace.fs.createDirectory(docuviaUri);
  await vscode.workspace.fs.createDirectory(decisionsUri);

  // Write skeleton YAML files (overwrite when re-initializing, skip when new)
  const writeFile = isAlreadyInitialized
    ? (uri: vscode.Uri, content: string) => vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'))
    : writeIfAbsent;

  await writeFile(
    vscode.Uri.file(path.join(targetRoot, '.docuvia', 'l1_tags.yaml')),
    `# L1 Tags — top-level knowledge categories\n# project_name: ${projectName}\nproject_name: "${projectName}"\ntags:\n# - id: <uuid>\n#   slug: <human-readable>\n#   name: <display name>\n#   description: <optional>\n`
  );

  await writeFile(
    vscode.Uri.file(path.join(targetRoot, '.docuvia', 'l2_modules.yaml')),
    `# L2 Modules — functional subsystems, linked to an L1 tag\n# - id: <uuid>\n#   slug: <human-readable>\n#   name: <display name>\n#   l1_tag_id: <L1 tag id>\n#   source_paths: []\n`
  );

  await writeFile(
    vscode.Uri.file(path.join(targetRoot, '.docuvia', 'l3_router.yaml')),
    `# L3 Router — performance index of all L3 decisions\n# - id: <uuid>\n#   l2_module_id: <L2 module id>\n#   slug: <human-readable>\n#   title: <decision title>\n#   file_path: l3_decisions/<slug>.md\n`
  );

  // Trigger reload to update state and hide welcome view
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
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage('Docuvia: No workspace folder is open.');
    return;
  }

  let targetRoot: string | undefined;

  // Prefer the workspace of the active editor
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder && store.snapshots.has(folder.uri.fsPath)) {
      targetRoot = folder.uri.fsPath;
    }
  }

  // If we couldn't resolve from editor, and there's only 1 initialized folder, use it
  if (!targetRoot) {
    const initialized = folders.filter(f => store.snapshots.has(f.uri.fsPath));
    if (initialized.length === 1) {
      targetRoot = initialized[0].uri.fsPath;
    } else if (initialized.length > 1) {
      const picks = initialized.map(f => ({ label: f.name, description: f.uri.fsPath, fsPath: f.uri.fsPath }));
      const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Select a project to add the decision to',
      });
      if (picked) {
        targetRoot = picked.fsPath;
      }
    } else {
      void vscode.window.showErrorMessage('Docuvia: No initialized project found. Please run Init Project first.');
      return;
    }
  }

  if (!targetRoot) return;
  const snapshot = store.snapshots.get(targetRoot);
  if (!snapshot) return;

  const { v4: uuidv4 } = await import('uuid');

  const title = await vscode.window.showInputBox({
    prompt: 'Decision title',
    validateInput: (v) => v.trim().length === 0 ? 'Title cannot be empty' : null,
  });
  if (!title) return;

  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const id = uuidv4();
  const date = new Date().toISOString().slice(0, 10);

  const modules = snapshot.modules ?? [];
  const moduleItems: (vscode.QuickPickItem & { id: string })[] = modules.map(m => ({ label: m.name, description: m.slug, id: m.id }));
  // BUG C-2 fix: use empty string "" sentinel instead of "unassigned"
  moduleItems.push({ label: '$(add) Create new module later...', id: '', description: 'Assign to a module later' });

  const picked = await vscode.window.showQuickPick(moduleItems, { placeHolder: 'Select L2 module (or leave unassigned)' });
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

  // BUG C-3 fix: guard against slug collision by appending a numeric suffix
  let finalSlug = slug;
  let attempt = 0;
  while (true) {
    const candidatePath = path.join(targetRoot, '.docuvia', 'l3_decisions', `${finalSlug}.md`);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
      // File exists — try next suffix
      attempt++;
      finalSlug = `${slug}-${attempt}`;
    } catch {
      // File does not exist — safe to write
      break;
    }
  }

  const filePath = path.join(targetRoot, '.docuvia', 'l3_decisions', `${finalSlug}.md`);
  const fileUri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(template, 'utf-8'));

  // BUG C-1 fix: update l3_router.yaml immediately after writing the markdown file
  const routerUri = vscode.Uri.file(path.join(targetRoot, '.docuvia', 'l3_router.yaml'));
  let existingRouter: unknown[] = [];
  try {
    const { parse: parseYaml, stringify: stringifyYaml } = await import('yaml');
    const routerBytes = await vscode.workspace.fs.readFile(routerUri);
    const parsed = parseYaml(Buffer.from(routerBytes).toString('utf-8'));
    if (Array.isArray(parsed)) existingRouter = parsed;
    existingRouter.push({ id, l2_module_id: picked.id, slug: finalSlug, title, file_path: `l3_decisions/${finalSlug}.md` });
    await vscode.workspace.fs.writeFile(routerUri, Buffer.from(stringifyYaml(existingRouter), 'utf-8'));
  } catch {
    // router file absent or unreadable — store.load() will still pick up the decision via full directory scan
  }

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
