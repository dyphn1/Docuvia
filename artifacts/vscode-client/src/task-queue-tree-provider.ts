import * as vscode from "vscode";

// ─── Domain types ─────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";
export type TaskType =
  "l1_extraction" | "l2_extraction" | "l3_extraction" | "l3_auto_categorization" | "generic";

export interface ExtractionTask {
  id: string;
  label: string;
  type: TaskType;
  status: TaskStatus;
  createdAt: Date;
  detail?: string;
}

export type TQNodeKind = "group" | "task";

export interface TQNode {
  kind: TQNodeKind;
  id: string;
  label: string;
  status?: TaskStatus;
  detail?: string;
}

// ─── Group config ─────────────────────────────────────────────────────────────

interface GroupConfig {
  status: TaskStatus;
  label: string;
  icon: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
}

const GROUP_CONFIGS: GroupConfig[] = [
  {
    status: "pending",
    label: "Pending",
    icon: "clock",
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
  },
  {
    status: "in_progress",
    label: "In Progress",
    icon: "sync~spin",
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
  },
  {
    status: "done",
    label: "Done",
    icon: "pass-filled",
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
  },
  {
    status: "failed",
    label: "Failed",
    icon: "error",
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
  },
];

const TASK_ICONS: Record<TaskStatus, string> = {
  pending: "circle-outline",
  in_progress: "loading~spin",
  done: "check",
  failed: "warning",
};

// ─── Provider ────────────────────────────────────────────────────────────────

export class TaskQueueTreeProvider implements vscode.TreeDataProvider<TQNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TQNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _tasks: ExtractionTask[] = [];

  getTreeItem(node: TQNode): vscode.TreeItem {
    if (node.kind === "group") {
      const config = GROUP_CONFIGS.find((g) => g.status === node.status);
      const item = new vscode.TreeItem(
        node.label,
        config?.collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed
      );
      item.iconPath = new vscode.ThemeIcon(config?.icon ?? "list-unordered");
      item.contextValue = "taskGroup";
      return item;
    }

    // task node
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    if (node.status) {
      item.iconPath = new vscode.ThemeIcon(TASK_ICONS[node.status]);
    }
    if (node.detail) {
      item.description = node.detail;
    }
    item.contextValue = "task";
    return item;
  }

  getChildren(node?: TQNode): TQNode[] {
    if (!node) {
      if (this._tasks.length === 0) {
        return [{ kind: "task", id: "empty_placeholder", label: "No extraction tasks yet" }];
      }
      // Return all 4 status groups
      return GROUP_CONFIGS.map((cfg): TQNode => ({
        kind: "group",
        id: `group_${cfg.status}`,
        label: cfg.label,
        status: cfg.status,
      }));
    }

    if (node.kind === "group" && node.status) {
      return this._tasks
        .filter((t) => t.status === node.status)
        .map((t): TQNode => ({
          kind: "task",
          id: t.id,
          label: t.label,
          status: t.status,
          detail: t.detail,
        }));
    }

    return [];
  }

  addTask(task: ExtractionTask): void {
    this._tasks.push(task);
    this._onDidChangeTreeData.fire();
  }

  updateTaskStatus(id: string, status: TaskStatus, detail?: string): void {
    const task = this._tasks.find((t) => t.id === id);
    if (task) {
      task.status = status;
      if (detail !== undefined) {
        task.detail = detail;
      }
      this._onDidChangeTreeData.fire();
    }
  }

  clearCompleted(): void {
    this._tasks = this._tasks.filter((t) => t.status !== "done");
    this._onDidChangeTreeData.fire();
  }

  getPendingCount(): number {
    return this._tasks.filter((t) => t.status === "pending").length;
  }

  getInProgressCount(): number {
    return this._tasks.filter((t) => t.status === "in_progress").length;
  }
}
