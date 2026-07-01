import * as path from "path";
import * as vscode from "vscode";
import { LocalSnapshotService, LocalGraphTraversalService } from "@workspace/core";
import {
  GlobalConfig,
  KnowledgeSnapshot,
  L1Tag,
  L2Module,
  L3Decision,
  L3RouterEntry,
} from "./types.js";
import { loadProjectSnapshot } from "./store/file-reader.js";
import { mapApiSnapshot } from "./store/formatters.js";

const DOCUVIA_DIR = ".docuvia";
const GIT_KNOWLEDGE_BRANCH = "docuvia-knowledge";

/** Structural interface used to avoid a circular import with CentralServerClient. */
interface IDocuviaClient {
  isServerConfigured(): boolean;
  pullSnapshot(projectId: number): Promise<KnowledgeSnapshot>;
}

/** A directed edge in the knowledge graph (mirrors server node_links table). */
export interface GraphEdge {
  id: number;
  sourceNodeId: number;
  targetNodeId: number;
  linkType: string;
}

/** A node in the traversal result. */
export interface TraversalNode {
  id: number;
  name: string;
  type: string;
  depth: number;
}

/** Result of a graph traversal operation. */
export interface TraversalResult {
  rootId: number;
  rootName: string;
  direction: "dependencies" | "dependents" | "both";
  nodes: TraversalNode[];
  edges: GraphEdge[];
  maxDepth: number;
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
  /** Directed edges loaded from node_links table (Zero-Server Deep Traversal). */
  edges: GraphEdge[];
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
    const snapshot = await loadProjectSnapshot(workspaceRoot, this._outputChannel);
    if (!snapshot) return false;

    this._snapshots.set(workspaceRoot, snapshot);
    return true;
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

  /**
   * Get all edges for a workspace. Returns an empty array if no snapshot loaded.
   */
  getEdgesFor(workspaceRoot: string): GraphEdge[] {
    return this._snapshots.get(workspaceRoot)?.edges ?? [];
  }

  /**
   * Zero-Server Deep Traversal — pure local SQLite graph queries.
   * Traverses the knowledge graph starting from a given L2 node, following
   * directed edges via a recursive CTE against the local SQLite database.
   *
   * This method operates entirely on the local .docuvia/local.db — no API
   * server calls are made. Falls back to in-memory edge traversal if the
   * SQLite file is not available.
   *
   * @param workspaceRoot - The workspace folder path
   * @param rootNodeId - The L2 node ID to start traversal from
   * @param direction - "dependencies" (outgoing edges), "dependents" (incoming edges), or "both"
   * @param maxDepth - Maximum traversal depth (default: 10)
   */
  traverseGraph(
    workspaceRoot: string,
    rootNodeId: number,
    direction: "dependencies" | "dependents" | "both" = "both",
    maxDepth: number = 10
  ): TraversalResult {
    const snap = this._snapshots.get(workspaceRoot);
    if (!snap) {
      return {
        rootId: rootNodeId,
        rootName: "unknown",
        direction,
        nodes: [],
        edges: [],
        maxDepth: 0,
      };
    }

    const rootModule = snap.modules.find((m) => Number(m.id) === rootNodeId);
    const rootName = rootModule?.name ?? `node-${rootNodeId}`;

    // Try SQLite recursive CTE first (faster, more complete)
    const sqliteResult = this._traverseViaSqlite(workspaceRoot, rootNodeId, direction, maxDepth);
    if (sqliteResult) {
      return sqliteResult;
    }

    // Fallback: in-memory BFS traversal using loaded edges
    return this._traverseInMemory(snap, rootNodeId, rootName, direction, maxDepth);
  }

  /**
   * Traverse graph using SQLite recursive CTE. Returns null if local.db
   * is unavailable or doesn't have node_links.
   */
  private _traverseViaSqlite(
    workspaceRoot: string,
    rootNodeId: number,
    direction: "dependencies" | "dependents" | "both",
    maxDepth: number
  ): TraversalResult | null {
    try {
      return LocalGraphTraversalService.traverseLocalSqlite(
        workspaceRoot,
        rootNodeId,
        direction,
        maxDepth
      );
    } catch (err) {
      this._outputChannel.appendLine(
        `[Docuvia] SQLite traversal failed, falling back to in-memory: ${String(err)}`
      );
      return null;
    }
  }

  /**
   * Fallback: in-memory BFS traversal using edges loaded into the snapshot.
   * Used when local.db is not available (e.g., knowledge loaded from YAML).
   */
  private _traverseInMemory(
    snap: KnowledgeGraphSnapshot,
    rootNodeId: number,
    rootName: string,
    direction: "dependencies" | "dependents" | "both",
    maxDepth: number
  ): TraversalResult {
    const visited = new Set<number>([rootNodeId]);
    const nodes: TraversalNode[] = [{ id: rootNodeId, name: rootName, type: "module", depth: 0 }];
    const edges: GraphEdge[] = [];
    let actualMaxDepth = 0;

    // BFS frontier
    let frontier = [rootNodeId];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: number[] = [];

      for (const nodeId of frontier) {
        for (const edge of snap.edges) {
          let neighborId: number | undefined;

          if (
            (direction === "dependencies" || direction === "both") &&
            edge.sourceNodeId === nodeId
          ) {
            neighborId = edge.targetNodeId;
          }
          if (
            (direction === "dependents" || direction === "both") &&
            edge.targetNodeId === nodeId
          ) {
            neighborId = edge.sourceNodeId;
          }

          if (neighborId !== undefined && !visited.has(neighborId)) {
            visited.add(neighborId);
            nextFrontier.push(neighborId);
            const neighborModule = snap.modules.find((m) => Number(m.id) === neighborId);
            nodes.push({
              id: neighborId,
              name: neighborModule?.name ?? `node-${neighborId}`,
              type: "module",
              depth,
            });
            edges.push(edge);
            actualMaxDepth = depth;
          }
        }
      }

      frontier = nextFrontier;
    }

    return { rootId: rootNodeId, rootName, direction, nodes, edges, maxDepth: actualMaxDepth };
  }

  // ─── Lookup helpers ────────────────────────────────────────────────────────
}
