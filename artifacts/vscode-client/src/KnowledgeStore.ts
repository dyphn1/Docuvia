import * as path from "path";
import * as vscode from "vscode";
import Database from "better-sqlite3";
import {
  GlobalConfig,
  KnowledgeSnapshot,
  L1Tag,
  L2Module,
  L3Decision,
  L3RouterEntry,
} from "./types.js";

const DOCUVIA_DIR = ".docuvia";
const GIT_KNOWLEDGE_BRANCH = "docuvia-knowledge";

/** Structural interface used to avoid a circular import with CentralServerClient. */
interface IDocuviaClient {
  isServerConfigured(): boolean;
  pullSnapshot(projectId: number): Promise<KnowledgeSnapshot>;
}

/** In-memory snapshot of the project's knowledge graph. */
export interface KnowledgeGraphSnapshot {
  workspaceRoot: string;
  projectName: string;
  tags: L1Tag[];
  modules: L2Module[];
  routerIndex: L3RouterEntry[];
  /** L3 decisions keyed by their ID for O(1) lookup. */
  decisions: Map<string, L3Decision>;
  loadedAt: Date;
}

/**
 * KnowledgeStore is a singleton that holds the in-memory parsed knowledge graph
 * for the current workspace. It is loaded once on activation and kept in sync via
 * a VS Code FileSystemWatcher.
 */
export class KnowledgeStore {
  private static _instance: KnowledgeStore | null = null;
  public static readonly onDidFinishIndexing = new vscode.EventEmitter<void>();

  private _snapshots: Map<string, KnowledgeGraphSnapshot> = new Map();
  private _globalConfig: GlobalConfig | null = null;
  private _watchers: Map<string, vscode.FileSystemWatcher> = new Map();
  private _outputChannel: vscode.OutputChannel;
  private _loading: boolean = false;
  private _pendingReload: boolean = false;
  private _client: IDocuviaClient | null = null;

  private readonly _onDidLoad = new vscode.EventEmitter<void>();
  readonly onDidLoad: vscode.Event<void> = this._onDidLoad.event;

  private constructor(outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel;
  }

  static getInstance(outputChannel: vscode.OutputChannel): KnowledgeStore {
    if (!KnowledgeStore._instance) {
      KnowledgeStore._instance = new KnowledgeStore(outputChannel);
    }
    return KnowledgeStore._instance;
  }

  get snapshots(): Map<string, KnowledgeGraphSnapshot> {
    return this._snapshots;
  }

  getSnapshotFor(uri: vscode.Uri | string): KnowledgeGraphSnapshot | undefined {
    const fsPath = typeof uri === "string" ? uri : uri.fsPath;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fsPath));
    if (folder) {
      return this._snapshots.get(folder.uri.fsPath);
    }
    // Fallback if not inside a folder
    return undefined;
  }

  get globalConfig(): GlobalConfig | null {
    return this._globalConfig;
  }

  setGlobalConfig(config: GlobalConfig): void {
    this._globalConfig = config;
  }

  setCentralClient(client: IDocuviaClient): void {
    this._client = client;
  }

  /**
   * Loads the knowledge graph from the .docuvia/ directory in all workspace roots.
   */
  async load(): Promise<boolean> {
    if (this._loading) {
      this._pendingReload = true;
      return false;
    }
    this._loading = true;
    try {
      this._snapshots.clear();
      let anyLoaded = false;
      const folders = vscode.workspace.workspaceFolders || [];
      for (const folder of folders) {
        const loaded = await this._loadWorkspace(folder.uri.fsPath);
        if (loaded) anyLoaded = true;
      }

      void vscode.commands.executeCommand("setContext", "docuvia:isInitialized", anyLoaded);
      this._onDidLoad.fire();
      KnowledgeStore.onDidFinishIndexing.fire();
      return anyLoaded;
    } finally {
      this._loading = false;
      if (this._pendingReload) {
        this._pendingReload = false;
        void this.load();
      }
    }
  }

  private async _loadWorkspace(workspaceRoot: string): Promise<boolean> {
    const docuviaDir = vscode.Uri.file(path.join(workspaceRoot, DOCUVIA_DIR));
    try {
      await vscode.workspace.fs.stat(docuviaDir);
    } catch {
      return false;
    }

    this._outputChannel.appendLine(`[Docuvia] Loading knowledge graph for ${workspaceRoot}...`);
    try {
      let tags: L1Tag[] = [];
      let modules: L2Module[] = [];
      let routerIndex: L3RouterEntry[] = [];
      let decisions = new Map<string, L3Decision>();
      let projectName = path.basename(workspaceRoot);

      // Local fallback: read from SQLite local.db
      if (tags.length === 0 && modules.length === 0) {
        try {
          const dbPath = path.join(docuviaDir.fsPath, "local.db");
          const fs = require('fs');
          if (fs.existsSync(dbPath)) {
            const db = new Database(dbPath, { readonly: true });
            
            const l1Rows = db.prepare("SELECT * FROM l1_tags").all() as any[];
            tags = l1Rows.map(row => ({ id: row.id, name: row.name, slug: row.slug, description: row.description }));
            
            const l2Rows = db.prepare("SELECT * FROM l2_nodes").all() as any[];
            modules = l2Rows.map(row => ({ 
              id: row.id, 
              name: row.name, 
              slug: row.slug, 
              l1_tag_id: row.l1_tag_id, 
              source_paths: row.source_paths ? JSON.parse(row.source_paths) : [],
              description: row.description 
            }));
            
            const l3Rows = db.prepare("SELECT * FROM l3_nodes").all() as any[];
            routerIndex = l3Rows.map(row => ({ 
              id: row.id, 
              l2_module_id: row.l2_node_id, 
              title: row.title, 
              slug: row.slug || "", 
              file_path: "" 
            }));
            
            for (const row of l3Rows) {
               decisions.set(row.id, {
                 id: row.id,
                 l2_module_id: row.l2_node_id,
                 title: row.title,
                 status: row.status,
                 date: row.created_at,
                 body: row.content || "",
                 filePath: ""
               });
            }
            db.close();
            
            if (tags.length > 0 && projectName === path.basename(workspaceRoot)) {
              projectName = tags[0].name; // Use first tag as project name if not set
            }
          }
        } catch (err) {
          this._outputChannel.appendLine(`[Docuvia] Local fallback failed: ${String(err)}`);
        }
      }

      this._snapshots.set(workspaceRoot, {
        workspaceRoot,
        projectName,
        tags,
        modules,
        routerIndex,
        decisions,
        loadedAt: new Date()
      });

      this._outputChannel.appendLine(
        `[Docuvia] Knowledge graph loaded for ${projectName}: ${tags.length} tags, ${modules.length} modules, ${routerIndex.length} L3 entries, ${decisions.size} decisions.`
      );

      return true;
    } catch (err) {
      this._outputChannel.appendLine(
        `[Docuvia] Error loading knowledge graph for ${workspaceRoot}: ${String(err)}`
      );
      return false;
    }
  }

  /**
   * Maps a server API KnowledgeSnapshot (integer IDs) to the extension's
   * KnowledgeGraphSnapshot format (string IDs, local types).
   */
  private _mapApiSnapshot(
    snapshot: KnowledgeSnapshot,
    workspaceRoot: string
  ): {
    projectName: string;
    tags: L1Tag[];
    modules: L2Module[];
    routerIndex: L3RouterEntry[];
    decisions: Map<string, L3Decision>;
  } {
    const slugify = (name: string) =>
      name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

    const tags: L1Tag[] = snapshot.l1Tags.map((t) => ({
      id: String(t.id),
      slug: slugify(t.name),
      name: t.name,
      description: t.description ?? undefined,
    }));

    const modules: L2Module[] = snapshot.l2Nodes.map((n) => ({
      id: String(n.id),
      slug: slugify(n.name),
      name: n.name,
      description: n.description ?? undefined,
      l1_tag_id: n.l1TagIds[0] !== undefined ? String(n.l1TagIds[0]) : "",
      source_paths: [],
    }));

    const routerIndex: L3RouterEntry[] = snapshot.l3Nodes.map((n) => ({
      id: String(n.id),
      l2_module_id: String(n.l2NodeId),
      slug: slugify(n.title),
      title: n.title,
      file_path: "",
    }));

    const decisions = new Map<string, L3Decision>();
    for (const n of snapshot.l3Nodes) {
      const id = String(n.id);
      decisions.set(id, {
        id,
        l2_module_id: String(n.l2NodeId),
        title: n.title,
        status: "accepted",
        body: n.content ?? "",
        filePath: "",
      });
    }

    return {
      projectName: path.basename(workspaceRoot),
      tags,
      modules,
      routerIndex,
      decisions,
    };
  }

  /**
   * Reads knowledge from the local docuvia-knowledge orphan branch via git CLI.
   * Falls back when the server is unreachable.
   */

  /**
   * Starts VS Code FileSystemWatchers on the .docuvia/ folder for all workspace folders.
   */
  startWatcher(context: vscode.ExtensionContext): void {
    // Cleanup old watchers
    for (const watcher of this._watchers.values()) {
      watcher.dispose();
    }
    this._watchers.clear();

    const folders = vscode.workspace.workspaceFolders || [];
    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(folder, ".docuvia/**");

      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      const pendingChanges = new Set<string>();

      const scheduleReload = (uri: vscode.Uri) => {
        // Ignore temp / non-knowledge files
        const ext = uri.fsPath.split(".").pop()?.toLowerCase();
        if (ext !== "db" && ext !== "md") return;

        pendingChanges.add(uri.fsPath);
        if (debounceTimer !== undefined) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          const changed = [...pendingChanges];
          pendingChanges.clear();
          this._handleBatchedChanges(folder.uri.fsPath, changed);
        }, 300);
      };

      watcher.onDidCreate(scheduleReload, null, context.subscriptions);
      watcher.onDidChange(scheduleReload, null, context.subscriptions);
      watcher.onDidDelete(scheduleReload, null, context.subscriptions);

      context.subscriptions.push(watcher);
      this._watchers.set(folder.uri.fsPath, watcher);
    }

    // Only register the workspace folder change listener once
    if (!KnowledgeStore._workspaceListenerRegistered) {
      context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
          this._outputChannel.appendLine("[Docuvia] Workspace folders changed, reloading store...");
          void this.load();
          this.startWatcher(context);
        })
      );
      KnowledgeStore._workspaceListenerRegistered = true;
    }

    this._outputChannel.appendLine(
      "[Docuvia] FileSystemWatchers started for .docuvia/** across workspaces."
    );
  }

  private static _workspaceListenerRegistered = false;

  /**
   * Decides between incremental (per-workspace) reload and full reload based on
   * the count and ratio thresholds from VS Code configuration.
   */
  private _handleBatchedChanges(workspaceRoot: string, changedPaths: string[]): void {
    const config = vscode.workspace.getConfiguration("docuvia");
    const countThreshold = config.get<number>("knowledgeGraph.incrementalUpdateThreshold", 50);
    const ratioThreshold = config.get<number>(
      "knowledgeGraph.incrementalUpdateRatioThreshold",
      0.5
    );

    const snap = this._snapshots.get(workspaceRoot);
    const totalFiles = snap
      ? snap.tags.length + snap.modules.length + snap.routerIndex.length + snap.decisions.size
      : 0;
    const ratio = totalFiles > 0 ? changedPaths.length / totalFiles : 1;

    if (changedPaths.length <= countThreshold && ratio <= ratioThreshold) {
      this._outputChannel.appendLine(
        `[Docuvia] Incremental reload for ${path.basename(workspaceRoot)} (${changedPaths.length} file(s) changed)`
      );
      void this._loadWorkspace(workspaceRoot).then(() => {
        void vscode.commands.executeCommand(
          "setContext",
          "docuvia:isInitialized",
          this._snapshots.size > 0
        );
        this._onDidLoad.fire();
      });
    } else {
      this._outputChannel.appendLine(
        `[Docuvia] Full reload triggered for ${path.basename(workspaceRoot)} (${changedPaths.length} file(s) changed, ratio ${ratio.toFixed(2)})`
      );
      void this.load();
    }
  }

  dispose(): void {
    for (const watcher of this._watchers.values()) {
      watcher.dispose();
    }
    this._watchers.clear();
    this._onDidLoad.dispose();
    KnowledgeStore._instance = null;
  }

  // ─── Lookup helpers ────────────────────────────────────────────────────────

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async readUriSafe(uri: vscode.Uri): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString("utf-8");
    } catch {
      return "";
    }
  }

  private tryParse<T>(fn: () => T, label: string): T extends any[] ? T : never {
    try {
      return fn() as T extends any[] ? T : never;
    } catch (err) {
      this._outputChannel.appendLine(`[Docuvia] Failed to parse ${label}: ${String(err)}`);
      return [] as unknown as T extends any[] ? T : never;
    }
  }
}
