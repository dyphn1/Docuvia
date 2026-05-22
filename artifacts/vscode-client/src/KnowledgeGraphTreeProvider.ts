import * as path from 'path';
import * as vscode from 'vscode';
import { KnowledgeStore } from './KnowledgeStore.js';

// ─── Node types ───────────────────────────────────────────────────────────────

export type KGNodeKind = 'l1tag' | 'l2module' | 'l3entry' | 'placeholder';

export interface KGNode {
  kind: KGNodeKind;
  id: string;
  label: string;
  /** Only present on l3entry nodes */
  filePath?: string;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class KnowledgeGraphTreeProvider implements vscode.TreeDataProvider<KGNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    KGNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: KnowledgeStore) {
    store.onDidLoad(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: KGNode): vscode.TreeItem {
    switch (node.kind) {
      case 'placeholder': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
      case 'l1tag': {
        const modules = this.store.getModulesByTagId(node.id);
        const state =
          modules.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(node.label, state);
        item.iconPath = new vscode.ThemeIcon('tag');
        item.contextValue = 'l1tag';
        return item;
      }
      case 'l2module': {
        const entries = this.store.getRouterEntriesByModuleId(node.id);
        const state =
          entries.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(node.label, state);
        item.iconPath = new vscode.ThemeIcon('package');
        item.contextValue = 'l2module';
        return item;
      }
      case 'l3entry': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('note');
        item.contextValue = 'l3entry';
        if (node.filePath) {
          item.command = {
            command: 'vscode.open',
            title: 'Open Decision',
            arguments: [vscode.Uri.file(node.filePath)],
          };
          item.tooltip = path.basename(node.filePath);
        }
        return item;
      }
    }
  }

  getChildren(node?: KGNode): KGNode[] {
    const snapshot = this.store.snapshot;

    if (!node) {
      // Root level — return L1 tags
      if (!snapshot || snapshot.tags.length === 0) {
        return [
          {
            kind: 'placeholder',
            id: '__placeholder__',
            label: 'No .docuvia/ folder found — run Init Project',
          },
        ];
      }
      return snapshot.tags.map(
        (tag): KGNode => ({
          kind: 'l1tag',
          id: tag.id,
          label: tag.name,
        })
      );
    }

    if (node.kind === 'l1tag') {
      return this.store.getModulesByTagId(node.id).map(
        (mod): KGNode => ({
          kind: 'l2module',
          id: mod.id,
          label: mod.name,
        })
      );
    }

    if (node.kind === 'l2module') {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return this.store.getRouterEntriesByModuleId(node.id).map((entry): KGNode => {
        const filePath = workspaceRoot
          ? path.join(workspaceRoot, '.docuvia', entry.file_path)
          : undefined;
        return {
          kind: 'l3entry',
          id: entry.id,
          label: entry.title,
          filePath,
        };
      });
    }

    return [];
  }
}
