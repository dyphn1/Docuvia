import * as vscode from "vscode";
import { openWorkspaceLocalDatabase } from "./db-helper.js";
import * as fs from "fs";
import * as path from "path";

// ─── Node types ───────────────────────────────────────────────────────────────

export type KGNode =
  | { kind: "project"; name: string; workspaceRoot: string; isInit: boolean }
  | {
      kind: "l1tag";
      id: number;
      name: string;
      slug: string;
      desc?: string;
      workspaceRoot: string;
    }
  | {
      kind: "l2module";
      id: number;
      name: string;
      slug: string;
      desc?: string;
      workspaceRoot: string;
    }
  | {
      kind: "l3decision";
      id: number;
      title: string;
      slug: string;
      filePath: string;
      l2ModuleId: number;
      workspaceRoot: string;
    }
  | {
      kind: "unassigned-group";
      name: string;
      workspaceRoot: string;
    }
  | {
      kind: "info";
      message: string;
    };

export class KnowledgeGraphTreeProvider
  implements vscode.TreeDataProvider<KGNode>, vscode.TreeDragAndDropController<KGNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<KGNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  public readonly dropMimeTypes = ["application/vnd.code.tree.docuvia.knowledgeGraph"];
  public readonly dragMimeTypes = ["application/vnd.code.tree.docuvia.knowledgeGraph"];

  private watchers: vscode.FileSystemWatcher[] = [];

  constructor() {
    this.setupWatchers();
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.setupWatchers();
      this.refresh();
    });
  }

  private setupWatchers() {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, ".docuvia/local.db")
        );
        watcher.onDidChange(() => this.refresh());
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());
        this.watchers.push(watcher);
      }
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async handleDrag(
    source: readonly KGNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const l3Nodes = source.filter((n) => n.kind === "l3decision");
    if (l3Nodes.length > 0) {
      dataTransfer.set(
        "application/vnd.code.tree.docuvia.knowledgeGraph",
        new vscode.DataTransferItem(l3Nodes)
      );
    }
  }

  async handleDrop(
    target: KGNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    if (!target || target.kind !== "l2module") return;

    const transferItem = dataTransfer.get("application/vnd.code.tree.docuvia.knowledgeGraph");
    if (!transferItem) return;

    const l3Nodes: KGNode[] = transferItem.value;
    if (!Array.isArray(l3Nodes)) return;

    if (l3Nodes.length > 0) {
      try {
        const db = openWorkspaceLocalDatabase(target.workspaceRoot);
        let changed = false;
        const updateStmt = db.prepare("UPDATE l3_nodes SET l2_node_id = ? WHERE id = ?");

        db.transaction(() => {
          for (const node of l3Nodes) {
            if (node.kind === "l3decision" && node.l2ModuleId !== target.id) {
              updateStmt.run(target.id, node.id);
              changed = true;
            }
          }
        })();

        db.close();

        if (changed) {
          this.refresh();
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to move decision: ${String(e)}`);
      }
    }
  }

  getTreeItem(node: KGNode): vscode.TreeItem {
    switch (node.kind) {
      case "project": {
        const item = new vscode.TreeItem(
          node.name,
          node.isInit
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon(node.isInit ? "database" : "new-folder");
        if (!node.isInit) {
          item.description = "Not initialized";
          item.contextValue = "project-uninit";
        } else {
          item.contextValue = "project-init";
        }
        return item;
      }
      case "l1tag": {
        const db = openWorkspaceLocalDatabase(node.workspaceRoot);
        const count = db
          .prepare("SELECT COUNT(*) as c FROM l2_nodes WHERE l1_tag_id = ?")
          .get(node.id).c;
        db.close();
        const state =
          count > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(node.name, state);
        item.iconPath = new vscode.ThemeIcon("tag");
        if (node.desc) item.tooltip = node.desc;
        item.description = node.slug;
        item.contextValue = "l1tag";
        return item;
      }
      case "unassigned-group": {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("question");
        item.contextValue = "unassigned-group";
        return item;
      }
      case "l2module": {
        const db = openWorkspaceLocalDatabase(node.workspaceRoot);
        const count = db
          .prepare("SELECT COUNT(*) as c FROM l3_nodes WHERE l2_node_id = ?")
          .get(node.id).c;
        db.close();
        const state =
          count > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(node.name, state);
        item.iconPath = new vscode.ThemeIcon("symbol-module");
        if (node.desc) item.tooltip = node.desc;
        item.description = node.slug;
        item.contextValue = "l2module";
        return item;
      }
      case "l3decision": {
        const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("file-code");
        item.tooltip = node.filePath;

        item.command = {
          title: "Open Decision",
          command: "docuvia.openDecision",
          arguments: [node.filePath],
        };
        item.contextValue = "l3decision";
        return item;
      }
      case "info": {
        const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
    }
  }

  async getChildren(node?: KGNode): Promise<KGNode[]> {
    if (!node) {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        return [{ kind: "info", message: "No workspace open" }];
      }
      return folders.map((folder): KGNode => {
        const isInit = fs.existsSync(path.join(folder.uri.fsPath, ".docuvia", "local.db"));
        return {
          kind: "project",
          name: folder.name,
          workspaceRoot: folder.uri.fsPath,
          isInit,
        };
      });
    }

    if (node.kind === "info") {
      return [];
    }

    const db = openWorkspaceLocalDatabase(node.workspaceRoot);

    try {
      if (node.kind === "project") {
        if (!node.isInit) {
          return [];
        }

        const tags = db.prepare("SELECT * FROM l1_tags").all();
        if (tags.length === 0) {
          return [{ kind: "info", message: "No L1 Tags. Run Explore." }];
        }

        const nodes: KGNode[] = tags.map((t: any) => ({
          kind: "l1tag",
          id: t.id,
          name: t.name,
          slug: t.slug,
          desc: t.description,
          workspaceRoot: node.workspaceRoot,
        }));

        const unassignedCount = db
          .prepare(
            "SELECT COUNT(*) as c FROM l3_nodes WHERE l2_node_id IS NULL OR l2_node_id NOT IN (SELECT id FROM l2_nodes)"
          )
          .get().c;
        if (unassignedCount > 0) {
          nodes.push({
            kind: "unassigned-group",
            name: "Unassigned Decisions",
            workspaceRoot: node.workspaceRoot,
          });
        }
        return nodes;
      }

      if (node.kind === "l1tag") {
        const modules = db.prepare("SELECT * FROM l2_nodes WHERE l1_tag_id = ?").all(node.id);
        return modules.map((m: any) => ({
          kind: "l2module",
          id: m.id,
          name: m.name,
          slug: m.slug,
          desc: m.description,
          workspaceRoot: node.workspaceRoot,
        }));
      }

      if (node.kind === "unassigned-group") {
        const unassigned = db
          .prepare(
            "SELECT * FROM l3_nodes WHERE l2_node_id IS NULL OR l2_node_id NOT IN (SELECT id FROM l2_nodes)"
          )
          .all();
        return unassigned.map((entry: any) => ({
          kind: "l3decision",
          id: entry.id,
          title: entry.title,
          slug: entry.slug,
          filePath: entry.file_path,
          l2ModuleId: 0,
          workspaceRoot: node.workspaceRoot,
        }));
      }

      if (node.kind === "l2module") {
        const entries = db.prepare("SELECT * FROM l3_nodes WHERE l2_node_id = ?").all(node.id);
        return entries.map((entry: any) => ({
          kind: "l3decision",
          id: entry.id,
          title: entry.title,
          slug: entry.slug,
          filePath: entry.file_path,
          l2ModuleId: node.id,
          workspaceRoot: node.workspaceRoot,
        }));
      }
    } finally {
      if (db) db.close();
    }

    return [];
  }
}
