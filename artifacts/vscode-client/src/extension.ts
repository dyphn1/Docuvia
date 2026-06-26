import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { CentralServerAuthError, CentralServerClient } from "./CentralServerClient.js";
import { registerDocuviaChatParticipant } from "./ChatParticipant.js";
import { CredentialManager } from "./CredentialManager.js";
import { DashboardPanel } from "./DashboardPanel.js";
import { CodeLensDecisionData, DocuviaCodeLensProvider } from "./DocuviaCodeLensProvider.js";
import { DocuviaHoverProvider } from "./DocuviaHoverProvider.js";
import { KnowledgeIndexer } from "./indexer/KnowledgeIndexer.js";
import { KGNode, KnowledgeGraphTreeProvider } from "./KnowledgeGraphTreeProvider.js";
import { KnowledgeStore } from "./KnowledgeStore.js";
import { parseGlobalConfig } from "./parser.js";
import { SearchResultsPanel } from "./SearchResultsPanel.js";
import { TaskQueueTreeProvider } from "./TaskQueueTreeProvider.js";
import { TaskRunner } from "./TaskRunner.js";
import { minimatch } from "minimatch";
import Database from "better-sqlite3";
import { parse as parseYaml } from "yaml";
import { randomUUID } from "crypto";

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

  // ─── Tree Providers ───────────────────────────────────────────────────────

  const kgProvider = new KnowledgeGraphTreeProvider(store);
  const kgTreeView = vscode.window.createTreeView("docuvia.knowledgeGraph", {
    treeDataProvider: kgProvider,
    dragAndDropController: kgProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(kgTreeView);

  const tqProvider = new TaskQueueTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("docuvia.taskQueue", tqProvider)
  );

  // ─── Task Runner ──────────────────────────────────────────────────────────

  const taskRunner = new TaskRunner(
    tqProvider,
    outputChannel,
    store,
    store.globalConfig ?? undefined
  );

  // ─── CodeLens Provider ────────────────────────────────────────────────────────

  const codeLensProvider = new DocuviaCodeLensProvider(store, context);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "typescript" },
        { language: "javascript" },
        { language: "typescriptreact" },
        { language: "javascriptreact" },
        { language: "python" },
      ],
      codeLensProvider
    )
  );

  // ─── Knowledge Indexer ──────────────────────────────────────────────────────

  const indexer = new KnowledgeIndexer(store);
  context.subscriptions.push(indexer);

  // ─── Hover Provider ───────────────────────────────────────────────────────────

  const hoverProvider = new DocuviaHoverProvider(store, indexer);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [
        { language: "yaml", pattern: "**/.docuvia/*.yaml" },
        { language: "markdown", pattern: "**/.docuvia/l3_decisions/*.md" },
      ],
      hoverProvider
    ),
    vscode.languages.registerHoverProvider({ language: "typescript" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "javascript" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "typescriptreact" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "javascriptreact" }, hoverProvider),
    vscode.languages.registerHoverProvider({ language: "python" }, hoverProvider)
  );

  // ─── Chat Participant ─────────────────────────────────────────────────────

  const chatParticipant = registerDocuviaChatParticipant(context, store, taskRunner, centralClient);
  context.subscriptions.push(chatParticipant);

  // ─── Commands ─────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.startExplore", async () => {
      // Open the Copilot Chat view with the explore command pre-filled and executed
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query: "@docuvia /explore",
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.initProject", async (node?: any) => {
      await initProject(context, store, centralClient, node);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.autoCategorizeDecisions", async (node?: KGNode) => {
      if (node && node.workspaceRoot) {
        const unassignedNodes = kgProvider.getChildren(node);
        if (unassignedNodes.length > 0) {
          await taskRunner.queueAutoCategorization(node.workspaceRoot, unassignedNodes);
          vscode.commands.executeCommand("docuvia.taskQueue.focus");
        } else {
          vscode.window.showInformationMessage("No unassigned decisions to categorize.");
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.refreshKnowledgeGraph", async () => {
      const loaded = await store.load();
      if (loaded) {
        void vscode.window.showInformationMessage("Docuvia: Knowledge graph refreshed.");
      } else {
        void vscode.window.showWarningMessage(
          "Docuvia: No .docuvia/ folder found in this workspace."
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.addDecision", async () => {
      await addDecision(context, store);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "docuvia.openDashboard",
      async (node?: { workspaceRoot?: string }) => {
        let targetRoot = node?.workspaceRoot;
        if (!targetRoot) {
          const folders = vscode.workspace.workspaceFolders || [];
          if (folders.length === 0) {
            void vscode.window.showWarningMessage("Docuvia: No workspace folder open.");
            return;
          } else if (folders.length === 1) {
            targetRoot = folders[0].uri.fsPath;
          } else {
            const picked = await vscode.window.showWorkspaceFolderPick({
              placeHolder: "Select a workspace for the dashboard",
            });
            if (!picked) return;
            targetRoot = picked.uri.fsPath;
          }
        }
        DashboardPanel.createOrShow(context, store, targetRoot, tqProvider);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.runExtraction", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("Docuvia: Open a file to extract decisions from.");
        return;
      }
      const filePath = editor.document.uri.fsPath;
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const relativePath = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, "/")
        : path.basename(filePath);

      const config = vscode.workspace.getConfiguration("docuvia");
      const includePatterns = config.get<string[]>("extraction.includePatterns", []);
      const maxLines = config.get<number>("extraction.maxLinesWarning", 1000);

      // Check against include patterns (like .gitignore check)
      const isIncluded = includePatterns.some((pattern) => minimatch(relativePath, pattern));
      if (!isIncluded) {
        const proceed = await vscode.window.showWarningMessage(
          `Docuvia: This file type (${path.basename(filePath)}) is not in your include list. Analyze it anyway?`,
          "Yes",
          "No"
        );
        if (proceed !== "Yes") return;
      }

      // Check line count limit
      const lineCount = editor.document.lineCount;
      if (lineCount > maxLines) {
        const proceed = await vscode.window.showWarningMessage(
          `Docuvia: This file is very large (${lineCount} lines). Analyzing the entire file might be slow and consume many tokens. We recommend selecting a specific block and using right-click "Docuvia: Add Decision from Selection". Proceed anyway?`,
          "Proceed",
          "Cancel"
        );
        if (proceed !== "Proceed") return;
      }

      // Check KB size limit
      const maxKB = config.get<number>("extraction.maxFileSizeKBWarning", 50);
      const fileSizeKB = Buffer.byteLength(editor.document.getText(), "utf-8") / 1024;
      if (fileSizeKB > maxKB) {
        const proceed = await vscode.window.showWarningMessage(
          `Docuvia: This file is large (${fileSizeKB.toFixed(1)} KB). Extraction might be slow. Proceed anyway?`,
          "Proceed",
          "Cancel"
        );
        if (proceed !== "Proceed") return;
      }

      const content = editor.document.getText();
      const tokenSource = new vscode.CancellationTokenSource();
      const taskId = await taskRunner
        .queueExtraction({
          label: `L3 extract: ${path.basename(filePath)}`,
          content,
          sourceFilePath: filePath,
          token: tokenSource.token,
        })
        .finally(() => tokenSource.dispose());
      void vscode.window.showInformationMessage(
        `Docuvia: Extraction task ${taskId} queued. Check Task Queue panel.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.clearCompletedTasks", () => {
      tqProvider.clearCompleted();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "docuvia.showDecisionsForLens",
      async (data: CodeLensDecisionData) => {
        await showDecisionsForLens(store, data);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.addDecisionFromSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showWarningMessage("Docuvia: Select code first.");
        return;
      }
      const selectedText = editor.document.getText(editor.selection);
      const langId = editor.document.languageId;
      const prefillBody = `\`\`\`${langId}\n${selectedText}\n\`\`\``;
      await addDecision(context, store, prefillBody);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.openDecision", async (filePath: string) => {
      if (!filePath) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "docuvia.acceptL1Tags",
      // BUG A-3 fix: accept explicit workspaceRoot from ChatParticipant
      async (yamlContent: string, explicitRoot: string) => {
        const workspaceRoot = explicitRoot;
        if (!workspaceRoot) {
          vscode.window.showErrorMessage(
            "Docuvia: Missing workspace root for acceptL1Tags command."
          );
          return;
        }

        const docuviaUri = vscode.Uri.file(path.join(workspaceRoot, ".docuvia"));
        const decisionsUri = vscode.Uri.file(path.join(workspaceRoot, ".docuvia", "l3_decisions"));

        // BUG A-1 fix: create .docuvia/ directory before writing
        await vscode.workspace.fs.createDirectory(docuviaUri);
        await vscode.workspace.fs.createDirectory(decisionsUri);

        try {
          const tags = parseYaml(yamlContent);
          if (Array.isArray(tags)) {
            const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");
            const db = new Database(dbPath);
            db.exec(`
              CREATE TABLE IF NOT EXISTS l1_tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                description TEXT
              );
              CREATE TABLE IF NOT EXISTS l2_nodes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                source_paths TEXT,
                l1_tag_id TEXT,
                description TEXT
              );
              CREATE TABLE IF NOT EXISTS l3_nodes (
                id TEXT PRIMARY KEY,
                l2_node_id TEXT,
                title TEXT NOT NULL,
                slug TEXT NOT NULL,
                status TEXT,
                created_at TEXT,
                content TEXT
              );
            `);
            
            const insert = db.prepare("INSERT OR REPLACE INTO l1_tags (id, name, slug, description) VALUES (?, ?, ?, ?)");
            for (const tag of tags) {
              const name = tag.name || "Unnamed";
              const slug = tag.slug || name.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '');
              const id = tag.id || randomUUID();
              const description = tag.description || "";
              insert.run(id, name, slug, description);
            }
            db.close();
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to insert L1 tags into local.db: ${err}`);
        }

        await store.load();
        void vscode.window.showInformationMessage(
          "Docuvia: L1 tags imported into local.db and knowledge graph initialized."
        );
      }
    )
  );

  outputChannel.appendLine("[Docuvia] Extension activated successfully.");

  // ─── Phase 5 Commands ─────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.setServerToken", async () => {
      const token = await vscode.window.showInputBox({
        prompt: "Enter your Docuvia server API token",
        password: true,
        placeHolder: "docuvia_token_...",
        validateInput: (v) => (v.trim().length === 0 ? "Token cannot be empty" : null),
      });
      if (token && token.trim().length > 0) {
        await credentialManager.setToken(token.trim());
        void vscode.window.showInformationMessage("Docuvia: Server token saved.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.clearServerToken", async () => {
      await credentialManager.clearToken();
      void vscode.window.showInformationMessage("Docuvia: Server token cleared.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.openSearch", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Search cross-project knowledge",
        placeHolder: "e.g. how do other projects handle auth",
      });
      if (!query || query.trim().length === 0) return;
      await executeSearch(context, centralClient, query.trim());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("docuvia.searchFromSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showWarningMessage("Docuvia: Select code or text to search.");
        return;
      }
      // BUG N-2 fix: cap query length to 2000 chars to prevent sending entire files to server
      const MAX_QUERY_LENGTH = 2000;
      const rawText = editor.document.getText(editor.selection).trim();
      const selectedText =
        rawText.length > MAX_QUERY_LENGTH ? rawText.slice(0, MAX_QUERY_LENGTH) : rawText;
      if (rawText.length > MAX_QUERY_LENGTH) {
        void vscode.window.showWarningMessage(
          `Docuvia: Selection was too long (${rawText.length} chars) and was truncated to ${MAX_QUERY_LENGTH} chars for search.`
        );
      }
      await executeSearch(context, centralClient, selectedText);
    })
  );
}

async function executeSearch(
  context: vscode.ExtensionContext,
  centralClient: CentralServerClient,
  query: string
) {
  try {
    const config = vscode.workspace.getConfiguration("docuvia");
    const viewPref = config.get<string>("search.defaultView", "chat");

    if (viewPref === "chat") {
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query: `@docuvia /query ${query}`,
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fs = require("fs/promises");
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectEcosystem(targetRoot: string): Promise<string[]> {
  const tags: string[] = [];
  const fs = require("fs/promises");
  const path = require("path");

  // O(1) file-existence checks
  if (await fileExists(path.join(targetRoot, "package.json"))) tags.push("typescript/javascript");
  if (
    (await fileExists(path.join(targetRoot, "pyproject.toml"))) ||
    (await fileExists(path.join(targetRoot, "requirements.txt")))
  )
    tags.push("python");
  if (await fileExists(path.join(targetRoot, "go.mod"))) tags.push("golang");
  if (await fileExists(path.join(targetRoot, "Cargo.toml"))) tags.push("rust");
  if (await fileExists(path.join(targetRoot, "pom.xml"))) tags.push("java");
  if (await fileExists(path.join(targetRoot, "build.gradle"))) tags.push("java");

  if (tags.length === 0) tags.push("unknown");
  return tags;
}

async function initProject(
  _context: vscode.ExtensionContext,
  store: KnowledgeStore,
  centralClient: CentralServerClient,
  node?: any
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Docuvia: No workspace folder is open.");
    return;
  }

  let targetRoot: string | undefined;

  if (node && node.workspaceRoot) {
    targetRoot = node.workspaceRoot;
  } else if (folders.length === 1) {
    targetRoot = folders[0].uri.fsPath;
  } else {
    const uninitialized = folders.filter((f) => !store.snapshots.has(f.uri.fsPath));
    if (uninitialized.length === 0) {
      void vscode.window.showInformationMessage(
        "Docuvia: All workspace folders are already initialized."
      );
      return;
    }
    const picks = uninitialized.map((f) => ({
      label: f.name,
      description: f.uri.fsPath,
      root: f.uri.fsPath,
    }));
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: "Select workspace folder to initialize",
    });
    if (!selected) return;
    targetRoot = selected.root;
  }

  if (targetRoot) {
    // Security: Validate targetRoot against path traversal
    const relativeToWorkspace = path.relative(
      folders.map((f) => f.uri.fsPath).join(","),
      targetRoot
    );
    if (relativeToWorkspace.startsWith("..")) {
      void vscode.window.showErrorMessage(
        "Docuvia: Invalid project root (path traversal attempt)."
      );
      return;
    }

    const cp = require("child_process");
    const util = require("util");
    const exec = util.promisify(cp.exec);

    try {
      const { stdout } = await exec("git status --porcelain", { cwd: targetRoot });
      if (stdout.trim().length > 0) {
        void vscode.window.showErrorMessage(
          "Please commit or stash your changes before initializing Docuvia. Creating an orphan branch requires a clean working tree."
        );
        return;
      }
    } catch (err: any) {
      void vscode.window.showErrorMessage(`Git error: ${err.message}`);
      return;
    }

    const NEW_GRAPH = "✨ Initialize Knowledge Graph here (New)";
    const CONNECT_GRAPH = "🔗 Connect to Remote Graph (Existing)";
    const DEMO_GRAPH = "📚 Clone & Explore Demo Sandbox (Demo)";

    const action = await vscode.window.showQuickPick([NEW_GRAPH, CONNECT_GRAPH, DEMO_GRAPH], {
      placeHolder: "Select Initialization Option",
    });

    if (!action) return;

    if (action === DEMO_GRAPH) {
      void vscode.window.showErrorMessage("Demo cloning is not yet implemented.");
      return;
    }

    if (action === CONNECT_GRAPH) {
      if (!centralClient || !centralClient.isServerConfigured()) {
        void vscode.window.showWarningMessage(
          "Cannot connect to remote graph. Server is offline or unreachable."
        );
        return;
      }
      try {
        const serverUrl = store.globalConfig?.server_url;
        await fetch(`${serverUrl}/health`);
        void vscode.window.showInformationMessage("Connected to remote graph successfully.");
      } catch {
        void vscode.window.showWarningMessage(
          "Cannot connect to remote graph. Server is offline or unreachable."
        );
      }
      return;
    }

    if (action === NEW_GRAPH) {
      const fs = require("fs/promises");
      const docuviaDir = path.join(targetRoot, ".docuvia");

      const docuviaExists = await fileExists(docuviaDir);
      if (docuviaExists) {
        const repair = await vscode.window.showWarningMessage(
          "Repair Workspace",
          "Proceed",
          "Cancel"
        );
        if (repair !== "Proceed") return;
      }

      let branchExists = false;
      try {
        const { stdout } = await exec("git branch --list docuvia-knowledge", { cwd: targetRoot });
        if (stdout.trim().length > 0) {
          branchExists = true;
        }
      } catch {}

      let shouldCreateBranch = true;
      if (branchExists) {
        const branchAction = await vscode.window.showWarningMessage(
          "Branch 'docuvia-knowledge' already exists.",
          "Connect to Existing",
          "Reset/Overwrite"
        );
        if (!branchAction) return;
        if (branchAction === "Reset/Overwrite") {
          await exec("git branch -D docuvia-knowledge", { cwd: targetRoot });
        } else {
          shouldCreateBranch = false;
        }
      }

      const consent = await vscode.window.showWarningMessage(
        "This will create a .docuvia/ folder for settings and a hidden docuvia-knowledge orphan branch for your graph. No source code will be modified. Proceed?",
        "Yes",
        "No"
      );
      if (consent !== "Yes") return;

      if (shouldCreateBranch) {
        try {
          await exec(
            'git checkout --orphan docuvia-knowledge && git reset --hard && git commit --allow-empty -m "chore: initialize empty knowledge graph" && git checkout -',
            { cwd: targetRoot }
          );
        } catch (err: any) {
          void vscode.window.showErrorMessage(`Failed to create branch: ${err.message}`);
          return;
        }
      }

      try {
        await fs.mkdir(docuviaDir, { recursive: true });
        await fs.mkdir(path.join(docuviaDir, "l3_decisions"), { recursive: true });
      } catch {}

      const projectName = path.basename(targetRoot);
      const dbPath = path.join(docuviaDir, "local.db");
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS l1_tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS l2_nodes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          source_paths TEXT,
          l1_tag_id TEXT
        );
        CREATE TABLE IF NOT EXISTS l3_nodes (
          id TEXT PRIMARY KEY,
          l2_node_id TEXT,
          title TEXT,
          content TEXT,
          status TEXT,
          created_at TEXT
        );
      `);
      db.close();

      // Install non-intrusive git post-commit hook
      try {
        const gitHookDir = path.join(targetRoot, ".git", "hooks");
        const postCommitPath = path.join(gitHookDir, "post-commit");
        if (require('fs').existsSync(gitHookDir)) {
          const hookContent = `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n# Non-intrusively extracts AST deltas in the background\nif command -v npx &> /dev/null; then\n  # Fire and forget (do not block commit)\n  git rev-parse HEAD | npx --no-install docuvia sync local > /dev/null 2>&1 &\nfi\n`;
          const fs = require('fs').promises;
          
          let shouldWriteHook = true;
          try {
            const existingHook = await fs.readFile(postCommitPath, 'utf8');
            if (existingHook.includes('docuvia sync')) {
              shouldWriteHook = false;
            }
          } catch (e) {
            // Hook doesn't exist, we can write it
          }

          if (shouldWriteHook) {
            await fs.appendFile(postCommitPath, `\n${hookContent}`, { mode: 0o755 });
            console.log("Installed Docuvia post-commit hook.");
          }
        }
      } catch (err) {
        console.warn("Could not install git hook:", err);
      }

      vscode.commands.executeCommand("docuvia.refreshKnowledgeGraph");
      void vscode.window.showInformationMessage(
        `Docuvia: Project "${projectName}" initialized. Populate the YAML files to build your knowledge graph.`
      );
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function writeIfAbsent(uri: vscode.Uri, content: string): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
    // File already exists — skip
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
  }
}

async function addDecision(
  context: vscode.ExtensionContext,
  store: KnowledgeStore,
  prefillBody: string = ""
) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  const workspaceRoot = folders[0].uri.fsPath;
  const docuviaDir = path.join(workspaceRoot, ".docuvia");

  try {
    const fs = require("fs/promises");
    await fs.stat(docuviaDir);
  } catch {
    void vscode.window.showWarningMessage("Docuvia: Initialize project first.");
    return;
  }

  const title = await vscode.window.showInputBox({ prompt: "Decision Title" });
  if (!title) return;

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return;

  const id = Date.now();
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(docuviaDir, "l3_decisions", filename);

  const content = `---\nid: ${id}\ntitle: "${title.replace(/"/g, '\\"')}"\ntype: decision\nstatus: valid\noccurrence_count: 1\n---\n\n${prefillBody}`;

  const fs = require("fs/promises");
  await fs.writeFile(filePath, content, "utf-8");

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc);
}

async function showDecisionsForLens(store: KnowledgeStore, data: CodeLensDecisionData) {
  const folders = vscode.workspace.workspaceFolders || [];
  const editor = vscode.window.activeTextEditor;
  const uri = editor ? editor.document.uri : folders.length > 0 ? folders[0].uri : undefined;
  if (!uri) return;

  const snapshot = store.getSnapshotFor(uri);
  const decisions = data.decisionIds
    .map((id) => snapshot?.decisions.get(id))
    .filter((d) => d !== undefined) as any[];

  if (decisions.length === 0) {
    void vscode.window.showInformationMessage("Docuvia: No decisions found for this module.");
    return;
  }

  const items = decisions.map((d) => ({
    label: d.title,
    description: `Type: ${d.type} | Status: ${d.status}`,
    decision: d,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a decision to open",
  });

  if (selected && selected.decision.filePath) {
    vscode.commands.executeCommand("docuvia.openDecision", selected.decision.filePath);
  }
}
