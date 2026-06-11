import { execFile as _execFile, spawn } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { parseDecision, parseManifest, parseSingleModule, parseTags, parseModules, parseRouter } from './parser.js';
import { GlobalConfig, KnowledgeSnapshot, L1Tag, L2Module, L3Decision, L3RouterEntry, ManifestModule } from './types.js';

const execFile = promisify(_execFile);

const DOCUVIA_DIR = '.docuvia';
const MANIFEST_FILE = 'manifest.yaml';
const GIT_KNOWLEDGE_BRANCH = 'docuvia-knowledge';

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
  /** Module names + path patterns from manifest.yaml — used for offline CodeLens matching. */
  manifestModules: ManifestModule[];
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
      // Always read manifest for offline CodeLens and projectId discovery
      const manifestContent = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, MANIFEST_FILE));
      const manifest = parseManifest(manifestContent, `${DOCUVIA_DIR}/${MANIFEST_FILE}`);

      let tags: L1Tag[] = [];
      let modules: L2Module[] = [];
      let routerIndex: L3RouterEntry[] = [];
      let decisions = new Map<string, L3Decision>();
      let projectName = path.basename(workspaceRoot);

      // Primary: server API
      if (this._client && this._client.isServerConfigured() && manifest.project_id !== undefined) {
        try {
          const apiSnapshot = await this._client.pullSnapshot(manifest.project_id);
          ({ tags, modules, routerIndex, decisions, projectName } = this._mapApiSnapshot(apiSnapshot, workspaceRoot));
          this._outputChannel.appendLine(`[Docuvia] Loaded from server API (project ${manifest.project_id}).`);
        } catch (err) {
          this._outputChannel.appendLine(`[Docuvia] Server unreachable, trying git fallback: ${String(err)}`);
        }
      }

      // Local fallback: read from .docuvia directory directly
      if (tags.length === 0 && modules.length === 0) {
        try {
          const tagsYaml = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, 'l1_tags.yaml'));
          if (tagsYaml) {
            tags = parseTags(tagsYaml, 'l1_tags.yaml');
            const match = tagsYaml.match(/^project_name:\s*"([^"\n]+)"/m);
            if (match) projectName = match[1];
          }

          const modulesYaml = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, 'l2_modules.yaml'));
          if (modulesYaml) modules = parseModules(modulesYaml, 'l2_modules.yaml');

          const routerYaml = await this.readUriSafe(vscode.Uri.joinPath(docuviaDir, 'l3_router.yaml'));
          if (routerYaml) routerIndex = parseRouter(routerYaml, 'l3_router.yaml');

          // Read l3_decisions
          const decisionsDir = vscode.Uri.joinPath(docuviaDir, 'l3_decisions');
          try {
            const entries = await vscode.workspace.fs.readDirectory(decisionsDir);
            for (const [name, type] of entries) {
              if (type === vscode.FileType.File && name.endsWith('.md')) {
                const md = await this.readUriSafe(vscode.Uri.joinPath(decisionsDir, name));
                if (md) {
                  const decision = parseDecision(md, name);
                  if (decision) decisions.set(decision.id, decision);
                }
              }
            }
          } catch {
            // decisions dir might not exist
          }
        } catch (err) {
          this._outputChannel.appendLine(`[Docuvia] Local fallback failed: ${String(err)}`);
        }
      }

      // Offline fallback: git show docuvia-knowledge:{projectId}/...
      if (tags.length === 0 && modules.length === 0 && manifest.project_id !== undefined) {
        try {
          const gitData = await this._loadFromGit(workspaceRoot, manifest.project_id);
          tags = gitData.tags;
          modules = gitData.modules;
          routerIndex = gitData.routerIndex;
          decisions = gitData.decisions;
          projectName = gitData.projectName;
          this._outputChannel.appendLine(`[Docuvia] Loaded from git fallback (branch ${GIT_KNOWLEDGE_BRANCH}).`);
        } catch (err) {
          this._outputChannel.appendLine(`[Docuvia] Git fallback failed: ${String(err)}`);
        }
      }

      this._snapshots.set(workspaceRoot, {
        workspaceRoot,
        projectName,
        tags,
        modules,
        routerIndex,
        decisions,
        loadedAt: new Date(),
        manifestModules: manifest.modules,
      });

      this._outputChannel.appendLine(
        `[Docuvia] Knowledge graph loaded for ${projectName}: ${tags.length} tags, ${modules.length} modules, ${routerIndex.length} L3 entries, ${decisions.size} decisions, ${manifest.modules.length} manifest modules.`
      );

      return true;
    } catch (err) {
      this._outputChannel.appendLine(`[Docuvia] Error loading knowledge graph for ${workspaceRoot}: ${String(err)}`);
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
  ): { projectName: string; tags: L1Tag[]; modules: L2Module[]; routerIndex: L3RouterEntry[]; decisions: Map<string, L3Decision> } {
    const slugify = (name: string) =>
      name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const tags: L1Tag[] = snapshot.l1Tags.map(t => ({
      id: String(t.id),
      slug: slugify(t.name),
      name: t.name,
      description: t.description ?? undefined,
    }));

    const modules: L2Module[] = snapshot.l2Nodes.map(n => ({
      id: String(n.id),
      slug: slugify(n.name),
      name: n.name,
      description: n.description ?? undefined,
      l1_tag_id: n.l1TagIds[0] !== undefined ? String(n.l1TagIds[0]) : '',
      source_paths: [],
    }));

    const routerIndex: L3RouterEntry[] = snapshot.l3Nodes.map(n => ({
      id: String(n.id),
      l2_module_id: String(n.l2NodeId),
      slug: slugify(n.title),
      title: n.title,
      file_path: '',
    }));

    const decisions = new Map<string, L3Decision>();
    for (const n of snapshot.l3Nodes) {
      const id = String(n.id);
      decisions.set(id, {
        id,
        l2_module_id: String(n.l2NodeId),
        title: n.title,
        status: 'accepted',
        body: n.content ?? '',
        filePath: '',
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
  private async _loadFromGit(
    workspaceRoot: string,
    projectId: number
  ): Promise<{ projectName: string; tags: L1Tag[]; modules: L2Module[]; routerIndex: L3RouterEntry[]; decisions: Map<string, L3Decision> }> {
    const treePath = `${GIT_KNOWLEDGE_BRANCH}:${projectId}`;
    const filesRaw = await this.runGit(['ls-tree', '-r', '--name-only', treePath], workspaceRoot).catch(() => '');
    const files = filesRaw
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
    const blobContents = await this.readGitBlobs(workspaceRoot, projectId, files);

    const tagsYaml = blobContents.get('l1_tags.yaml') ?? '';
    const tags = tagsYaml ? parseTags(tagsYaml, 'l1_tags.yaml') : [];
    const projectName =
      tagsYaml.match(/^project_name:\s*"?([^"\n]+)"?/m)?.[1] ?? path.basename(workspaceRoot);

    const modules: L2Module[] = [];
    const moduleFiles = files.filter(f => f.startsWith('l2_modules/') && f.endsWith('.yaml'));
    for (const file of moduleFiles) {
      const yaml = blobContents.get(file) ?? '';
      if (yaml) {
        const mod = parseSingleModule(yaml, path.basename(file));
        if (mod) modules.push(mod);
      }
    }

    const decisions = new Map<string, L3Decision>();
    const routerIndex: L3RouterEntry[] = [];

    const decisionFiles = files.filter(f => f.startsWith('l3_decisions/') && f.endsWith('.md'));
    for (const file of decisionFiles) {
      const md = blobContents.get(file) ?? '';
      if (md) {
        const relativeFile = file.replace(/^l3_decisions\//, '');
        const decision = parseDecision(md, relativeFile);
        if (decision) {
          decisions.set(decision.id, decision);
          routerIndex.push({
            id: decision.id,
            l2_module_id: decision.l2_module_id,
            slug: relativeFile.replace(/\.md$/, ''),
            title: decision.title,
            file_path: relativeFile,
          });
        }
      }
    }

    return { projectName, tags, modules, routerIndex, decisions };
  }

  private async runGit(args: string[], workspaceRoot: string): Promise<string> {
    const { stdout } = await execFile('git', args, {
      cwd: workspaceRoot,
      maxBuffer: 100 * 1024 * 1024,
    });
    return stdout;
  }

  private readGitBlobs(
    workspaceRoot: string,
    projectId: number,
    files: string[]
  ): Promise<Map<string, string>> {
    const contents = new Map<string, string>();
    const requested = files.filter(file =>
      file === 'l1_tags.yaml' ||
      (file.startsWith('l2_modules/') && file.endsWith('.yaml')) ||
      (file.startsWith('l3_decisions/') && file.endsWith('.md'))
    );

    if (requested.length === 0) {
      return Promise.resolve(contents);
    }

    return new Promise((resolve, reject) => {
      const child = spawn('git', ['cat-file', '--batch'], {
        cwd: workspaceRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stderrChunks: Buffer[] = [];
      const stdoutChunks: Buffer[] = [];

      child.stderr.on('data', chunk => {
        stderrChunks.push(Buffer.from(chunk));
      });

      child.stdout.on('data', chunk => {
        stdoutChunks.push(Buffer.from(chunk));
      });

      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8');
          reject(new Error(`git cat-file --batch failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          const output = Buffer.concat(stdoutChunks);
          let offset = 0;
          for (const file of requested) {
            const newline = output.indexOf(0x0a, offset);
            if (newline === -1) break;

            const header = output.subarray(offset, newline).toString('utf8');
            offset = newline + 1;

            if (header.endsWith(' missing')) {
              continue;
            }

            const [, type, sizeRaw] = header.match(/^[0-9a-f]+ (\w+) (\d+)$/) ?? [];
            const size = Number(sizeRaw);
            if (type !== 'blob' || !Number.isFinite(size)) {
              throw new Error(`Unexpected git cat-file header: ${header}`);
            }

            const blob = output.subarray(offset, offset + size);
            contents.set(file, blob.toString('utf8'));
            offset += size + 1;
          }

          resolve(contents);
        } catch (err) {
          reject(err);
        }
      });

      for (const file of requested) {
        child.stdin.write(`${GIT_KNOWLEDGE_BRANCH}:${projectId}/${file}\n`);
      }
      child.stdin.end();
    });
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

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      const pendingChanges = new Set<string>();

      const scheduleReload = (uri: vscode.Uri) => {
        // Ignore temp / non-knowledge files
        const ext = uri.fsPath.split('.').pop()?.toLowerCase();
        if (ext !== 'yaml' && ext !== 'md') return;

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

  /**
   * Decides between incremental (per-workspace) reload and full reload based on
   * the count and ratio thresholds from VS Code configuration.
   */
  private _handleBatchedChanges(workspaceRoot: string, changedPaths: string[]): void {
    const config = vscode.workspace.getConfiguration('docuvia');
    const countThreshold = config.get<number>('knowledgeGraph.incrementalUpdateThreshold', 50);
    const ratioThreshold = config.get<number>('knowledgeGraph.incrementalUpdateRatioThreshold', 0.5);

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
        void vscode.commands.executeCommand('setContext', 'docuvia:isInitialized', this._snapshots.size > 0);
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
      return Buffer.from(bytes).toString('utf-8');
    } catch {
      return '';
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
