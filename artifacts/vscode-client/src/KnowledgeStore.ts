import * as path from 'path';
import * as vscode from 'vscode';
import { parseDecision, parseModules, parseRouter, parseTags } from './parser.js';
import { GlobalConfig, L1Tag, L2Module, L3Decision, L3RouterEntry } from './types.js';

const DOCUVIA_DIR = '.docuvia';
const L1_TAGS_FILE = 'l1_tags.yaml';
const L2_MODULES_FILE = 'l2_modules.yaml';
const L3_ROUTER_FILE = 'l3_router.yaml';
const L3_DECISIONS_DIR = 'l3_decisions';

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

  private _snapshots: Map<string, KnowledgeGraphSnapshot> = new Map();
  private _globalConfig: GlobalConfig | null = null;
  private _watchers: Map<string, vscode.FileSystemWatcher> = new Map();
  private _outputChannel: vscode.OutputChannel;
  private _loading: boolean = false;
  private _pendingReload: boolean = false;

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

  /** Gets aggregated snapshot or the first one, for backwards compatibility where possible, but better to use snapshots map directly */
  get snapshot(): KnowledgeGraphSnapshot | null {
    if (this._snapshots.size === 0) return null;
    // Aggregate for legacy single-snapshot callers
    const agg: KnowledgeGraphSnapshot = {
      workspaceRoot: '',
      projectName: 'Aggregated',
      tags: [],
      modules: [],
      routerIndex: [],
      decisions: new Map(),
      loadedAt: new Date()
    };
    for (const snap of this._snapshots.values()) {
      agg.tags.push(...snap.tags);
      agg.modules.push(...snap.modules);
      agg.routerIndex.push(...snap.routerIndex);
      for (const [k, v] of snap.decisions.entries()) {
        agg.decisions.set(k, v);
      }
    }
    return agg;
  }

  getSnapshotFor(uri: vscode.Uri | string): KnowledgeGraphSnapshot | undefined {
    const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
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
      
      void vscode.commands.executeCommand('setContext', 'docuvia:isInitialized', anyLoaded);
      this._onDidLoad.fire();
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
      const tagsContent = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, L1_TAGS_FILE));
      let projectName = path.basename(workspaceRoot);
      const projMatch = tagsContent.match(/^project_name:\s*"?([^"\n]+)"?/m);
      if (projMatch) {
        projectName = projMatch[1];
      }

      const tags = this.tryParse(() =>
        parseTags(tagsContent, 'l1_tags.yaml'), 'l1_tags.yaml'
      );

      const modulesContent = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, L2_MODULES_FILE));
      const modules = this.tryParse(() =>
        parseModules(modulesContent, 'l2_modules.yaml'), 'l2_modules.yaml'
      );

      const routerContent = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, L3_ROUTER_FILE));
      const routerIndex = this.tryParse(() =>
        parseRouter(routerContent, 'l3_router.yaml'), 'l3_router.yaml'
      );

      const decisions = new Map<string, L3Decision>();
      const decisionsDir = vscode.Uri.joinPath(docuviaDir, L3_DECISIONS_DIR);
      
      try {
        const entries = await vscode.workspace.fs.readDirectory(decisionsDir);
        for (const [name, type] of entries) {
          if (type === vscode.FileType.File && name.endsWith('.md')) {
            const fileUri = vscode.Uri.joinPath(decisionsDir, name);
            const content = await this.readUriSafe(fileUri);
            const decision = parseDecision(content, fileUri.fsPath);
            if (decision) {
              decisions.set(decision.id, decision);
            }
          }
        }
      } catch {
        // L3 dir might not exist
      }

      this._snapshots.set(workspaceRoot, { workspaceRoot, projectName, tags, modules, routerIndex, decisions, loadedAt: new Date() });
      this._outputChannel.appendLine(
        `[Docuvia] Knowledge graph loaded for ${projectName}: ${tags.length} tags, ${modules.length} modules, ${routerIndex.length} L3 entries, ${decisions.size} decisions.`
      );
      
      return true;
    } catch (err) {
      this._outputChannel.appendLine(`[Docuvia] Error loading knowledge graph for ${workspaceRoot}: ${String(err)}`);
      return false;
    }
  }

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
      const pattern = new vscode.RelativePattern(
        folder,
        '.docuvia/**'
      );

      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      const reload = () => {
        this._outputChannel.appendLine(`[Docuvia] Change detected in ${folder.name}/.docuvia/, reloading...`);
        void this.load();
      };

      watcher.onDidCreate(reload, null, context.subscriptions);
      watcher.onDidChange(reload, null, context.subscriptions);
      watcher.onDidDelete(reload, null, context.subscriptions);

      context.subscriptions.push(watcher);
      this._watchers.set(folder.uri.fsPath, watcher);
    }

    // Only register the workspace folder change listener once
    if (!KnowledgeStore._workspaceListenerRegistered) {
      context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
          this._outputChannel.appendLine('[Docuvia] Workspace folders changed, reloading store...');
          void this.load();
          this.startWatcher(context);
        })
      );
      KnowledgeStore._workspaceListenerRegistered = true;
    }

    this._outputChannel.appendLine('[Docuvia] FileSystemWatchers started for .docuvia/** across workspaces.');
  }

  private static _workspaceListenerRegistered = false;

  dispose(): void {
    for (const watcher of this._watchers.values()) {
      watcher.dispose();
    }
    this._watchers.clear();
    this._onDidLoad.dispose();
    KnowledgeStore._instance = null;
  }

  // ─── Lookup helpers ────────────────────────────────────────────────────────

  getDecisionById(id: string): L3Decision | undefined {
    return this.snapshot?.decisions.get(id);
  }

  getModulesByTagId(tagId: string): L2Module[] {
    return this.snapshot?.modules.filter(m => m.l1_tag_id === tagId) ?? [];
  }

  getRouterEntriesByModuleId(moduleId: string): L3RouterEntry[] {
    return this.snapshot?.routerIndex.filter(r => r.l2_module_id === moduleId) ?? [];
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async readUriSafe(uri: vscode.Uri): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf-8');
    } catch {
      return '';
    }
  }

  private getWorkspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
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
