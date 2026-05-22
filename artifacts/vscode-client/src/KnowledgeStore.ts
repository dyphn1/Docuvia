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

  private _snapshot: KnowledgeGraphSnapshot | null = null;
  private _globalConfig: GlobalConfig | null = null;
  private _watcher: vscode.FileSystemWatcher | null = null;
  private _outputChannel: vscode.OutputChannel;

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

  get snapshot(): KnowledgeGraphSnapshot | null {
    return this._snapshot;
  }

  get globalConfig(): GlobalConfig | null {
    return this._globalConfig;
  }

  setGlobalConfig(config: GlobalConfig): void {
    this._globalConfig = config;
  }

  /**
   * Loads the knowledge graph from the .docuvia/ directory in the workspace root.
   * Returns false if no workspace or no .docuvia folder is present.
   */
  async load(): Promise<boolean> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      this._outputChannel.appendLine('[Docuvia] No workspace folder found. Knowledge graph not loaded.');
      return false;
    }

    const docuviaDir = vscode.Uri.file(path.join(workspaceRoot, DOCUVIA_DIR));
    try {
      await vscode.workspace.fs.stat(docuviaDir);
    } catch {
      this._outputChannel.appendLine(`[Docuvia] No .docuvia/ folder found in ${workspaceRoot}`);
      return false;
    }

    this._outputChannel.appendLine('[Docuvia] Loading knowledge graph...');
    try {
      const tagsContent = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, L1_TAGS_FILE));
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

      this._snapshot = { tags, modules, routerIndex, decisions, loadedAt: new Date() };
      this._outputChannel.appendLine(
        `[Docuvia] Knowledge graph loaded: ${tags.length} tags, ${modules.length} modules, ${routerIndex.length} L3 entries, ${decisions.size} decisions.`
      );
      this._onDidLoad.fire();
      return true;
    } catch (err) {
      this._outputChannel.appendLine(`[Docuvia] Error loading knowledge graph: ${String(err)}`);
      return false;
    }
  }

  /**
   * Starts a VS Code FileSystemWatcher on the .docuvia/ folder.
   * Any create/change/delete event triggers a full reload.
   */
  startWatcher(context: vscode.ExtensionContext): void {
    if (this._watcher) {
      this._watcher.dispose();
    }

    const pattern = new vscode.RelativePattern(
      this.getWorkspaceRoot() ?? '',
      '.docuvia/**'
    );

    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = () => {
      this._outputChannel.appendLine('[Docuvia] Change detected in .docuvia/, reloading...');
      void this.load();
    };

    this._watcher.onDidCreate(reload, null, context.subscriptions);
    this._watcher.onDidChange(reload, null, context.subscriptions);
    this._watcher.onDidDelete(reload, null, context.subscriptions);

    context.subscriptions.push(this._watcher);
    this._outputChannel.appendLine('[Docuvia] FileSystemWatcher started for .docuvia/**');
  }

  dispose(): void {
    this._watcher?.dispose();
    this._watcher = null;
    this._onDidLoad.dispose();
    KnowledgeStore._instance = null;
  }

  // ─── Lookup helpers ────────────────────────────────────────────────────────

  getDecisionById(id: string): L3Decision | undefined {
    return this._snapshot?.decisions.get(id);
  }

  getModulesByTagId(tagId: string): L2Module[] {
    return this._snapshot?.modules.filter(m => m.l1_tag_id === tagId) ?? [];
  }

  getRouterEntriesByModuleId(moduleId: string): L3RouterEntry[] {
    return this._snapshot?.routerIndex.filter(r => r.l2_module_id === moduleId) ?? [];
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
