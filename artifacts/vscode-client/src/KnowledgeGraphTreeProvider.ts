import * as path from 'path';
import * as vscode from 'vscode';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { KnowledgeStore } from './KnowledgeStore.js';

// ─── Node types ───────────────────────────────────────────────────────────────

export type KGNodeKind = 'project' | 'l1tag' | 'l2module' | 'l3entry' | 'placeholder' | 'unassigned-group';

export interface KGNode {
  kind: KGNodeKind;
  id: string;
  label: string;
  /** Present on project, l1tag, l2module, l3entry nodes */
  workspaceRoot?: string;
  /** Only present on l3entry nodes */
  filePath?: string;
  /** Only present on project nodes */
  initialized?: boolean;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class KnowledgeGraphTreeProvider implements vscode.TreeDataProvider<KGNode>, vscode.TreeDragAndDropController<KGNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    KGNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  public readonly dropMimeTypes = ['application/vnd.code.tree.docuvia.knowledgeGraph'];
  public readonly dragMimeTypes = ['application/vnd.code.tree.docuvia.knowledgeGraph'];

  constructor(private readonly store: KnowledgeStore) {
    store.onDidLoad(() => this.refresh());
  }

  public async handleDrag(source: readonly KGNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const l3Nodes = source.filter(n => n.kind === 'l3entry');
    if (l3Nodes.length > 0) {
      dataTransfer.set('application/vnd.code.tree.docuvia.knowledgeGraph', new vscode.DataTransferItem(l3Nodes));
    }
  }

  public async handleDrop(target: KGNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    if (!target || target.kind !== 'l2module' || !target.workspaceRoot) {
      return;
    }
    const transferItem = dataTransfer.get('application/vnd.code.tree.docuvia.knowledgeGraph');
    if (!transferItem) {
      return;
    }
    const nodes: KGNode[] = transferItem.value;
    const l3Nodes = nodes.filter(n => n.kind === 'l3entry' && n.workspaceRoot === target.workspaceRoot);

    if (l3Nodes.length > 0) {
      const snap = this.store.snapshots.get(target.workspaceRoot);
      if (!snap) return;

      const routerPath = path.join(target.workspaceRoot, '.docuvia', 'l3_router.yaml');
      try {
        const routerBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(routerPath));
        const existingRouter = parseYaml(Buffer.from(routerBytes).toString('utf-8')) || [];
        
        let changed = false;
        for (const node of l3Nodes) {
          const entry = existingRouter.find((r: any) => r.id === node.id);
          if (entry) {
            entry.l2_module_id = target.id;
            changed = true;
          }
        }
        
        if (changed) {
          await vscode.workspace.fs.writeFile(vscode.Uri.file(routerPath), Buffer.from(stringifyYaml(existingRouter), 'utf-8'));
          await this.store.load();
        }
      } catch (e) {
        console.error('Failed to update l3_router.yaml after drag and drop', e);
      }
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: KGNode): vscode.TreeItem {
    switch (node.kind) {
      case 'unassigned-group': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('question');
        item.contextValue = 'unassigned-group';
        return item;
      }
      case 'placeholder': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
      case 'project': {
        const state = node.initialized
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(node.label, state);
        item.iconPath = new vscode.ThemeIcon('root-folder');
        item.contextValue = node.initialized ? 'project-initialized' : 'project-uninitialized';
        if (!node.initialized) {
          item.tooltip = 'Click "Init" to initialize .docuvia/ for this workspace.';
        }
        return item;
      }
      case 'l1tag': {
        // Need snapshot for this workspace to know if there are modules
        const snap = node.workspaceRoot ? this.store.snapshots.get(node.workspaceRoot) : undefined;
        const modules = snap ? snap.modules.filter(m => m.l1_tag_id === node.id) : [];
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
        const snap = node.workspaceRoot ? this.store.snapshots.get(node.workspaceRoot) : undefined;
        const entries = snap ? snap.routerIndex.filter(r => r.l2_module_id === node.id) : [];
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
    const folders = vscode.workspace.workspaceFolders || [];
    
    if (!node) {
      // Root level — return project nodes (one per workspace folder)
      if (folders.length === 0) {
        return [
          {
            kind: 'placeholder',
            id: '__placeholder__',
            label: 'No workspace folder open',
          },
        ];
      }
      return folders.map((folder): KGNode => {
        const isInit = this.store.snapshots.has(folder.uri.fsPath);
        return {
          kind: 'project',
          id: folder.uri.fsPath,
          label: folder.name,
          workspaceRoot: folder.uri.fsPath,
          initialized: isInit
        };
      });
    }

    if (node.kind === 'project') {
      if (!node.initialized || !node.workspaceRoot) {
        return [];
      }
      const snap = this.store.snapshots.get(node.workspaceRoot);
      if (!snap || snap.tags.length === 0) {
        return [
          {
            kind: 'placeholder',
            id: `__placeholder__${node.id}`,
            label: 'No L1 tags found in l1_tags.yaml',
          },
        ];
      }
      const tagChildren: KGNode[] = snap.tags.map(
        (tag): KGNode => ({
          kind: 'l1tag',
          id: tag.id,
          label: tag.name,
          workspaceRoot: node.workspaceRoot,
        })
      );
      // Append unassigned-group node if there are any unassigned decisions
      const validModuleIds = new Set(snap.modules.map(m => m.id));
      const hasUnassigned = [...snap.decisions.values()].some(
        d => d.l2_module_id === 'unassigned' || !validModuleIds.has(d.l2_module_id)
      );
      if (hasUnassigned) {
        tagChildren.push({
          kind: 'unassigned-group',
          id: '__unassigned__',
          label: 'Unassigned Decisions',
          workspaceRoot: node.workspaceRoot,
        });
      }
      return tagChildren;
    }

    if (node.kind === 'l1tag') {
      const snap = node.workspaceRoot ? this.store.snapshots.get(node.workspaceRoot) : undefined;
      const modules = snap ? snap.modules.filter(m => m.l1_tag_id === node.id) : [];
      return modules.map(
        (mod): KGNode => ({
          kind: 'l2module',
          id: mod.id,
          label: mod.name,
          workspaceRoot: node.workspaceRoot,
        })
      );
    }

    if (node.kind === 'unassigned-group') {
      const snap = node.workspaceRoot ? this.store.snapshots.get(node.workspaceRoot) : undefined;
      if (!snap) return [];
      const validModuleIds = new Set(snap.modules.map(m => m.id));
      const unassigned = [...snap.decisions.values()].filter(
        d => d.l2_module_id === 'unassigned' || !validModuleIds.has(d.l2_module_id)
      );
      return unassigned.map((d): KGNode => ({
        kind: 'l3entry',
        id: d.id,
        label: d.title,
        filePath: d.filePath,
        workspaceRoot: node.workspaceRoot,
      }));
    }

    if (node.kind === 'l2module') {
      const snap = node.workspaceRoot ? this.store.snapshots.get(node.workspaceRoot) : undefined;
      const entries = snap ? snap.routerIndex.filter(r => r.l2_module_id === node.id) : [];
      return entries.map((entry): KGNode => {
        const filePath = node.workspaceRoot
          ? path.join(node.workspaceRoot, '.docuvia', entry.file_path)
          : undefined;
        return {
          kind: 'l3entry',
          id: entry.id,
          label: entry.title,
          filePath,
          workspaceRoot: node.workspaceRoot,
        };
      });
    }

    return [];
  }
}
