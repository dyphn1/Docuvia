import * as vscode from "vscode";
import { ExtractionTask, TaskQueueTreeProvider, TaskType } from "./task-queue-tree-provider.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { KGNode } from "./knowledge-graph-tree-provider.js";
import { ExtractionHandler } from "./tasks/extractor.js";
import { AutoCategorizationHandler } from "./tasks/categorizer.js";

// ─── Public interface ─────────────────────────────────────────────────────────

export interface ExtractionParams {
  label: string;
  content: string;
  sourceFilePath: string;
  token: vscode.CancellationToken;
  type?: TaskType;
}

// ─── TaskRunner ───────────────────────────────────────────────────────────────

export class TaskRunner {
  private extractionHandler: ExtractionHandler;
  private autoCategorizationHandler: AutoCategorizationHandler;

  constructor(
    private readonly tqProvider: TaskQueueTreeProvider,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly store: KnowledgeStore,
    private readonly globalConfig?: { chunking_strategy?: "line" | "ast" }
  ) {
    this.extractionHandler = new ExtractionHandler(tqProvider, outputChannel, store, globalConfig);
    this.autoCategorizationHandler = new AutoCategorizationHandler(
      tqProvider,
      outputChannel,
      store
    );
  }

  /**
   * Splits content into chunks and processes each one sequentially using the
   * VS Code Language Model API. Updates TaskQueueTreeProvider throughout.
   * Returns the task ID.
   */
  async queueExtraction(params: ExtractionParams): Promise<string> {
    const { v4: uuidv4 } = await import("uuid");
    const taskId = uuidv4();

    const task: ExtractionTask = {
      id: taskId,
      label: params.label,
      type: params.type ?? "l3_extraction",
      status: "pending",
      createdAt: new Date(),
    };

    this.tqProvider.addTask(task);

    // Run asynchronously — do not await here so chat response returns immediately
    void this.extractionHandler.runExtractionAsync(taskId, params);

    return taskId;
  }

  async queueAutoCategorization(workspaceRoot: string, unassignedNodes: KGNode[]): Promise<string> {
    const { v4: uuidv4 } = await import("uuid");
    const taskId = uuidv4();

    const task: ExtractionTask = {
      id: taskId,
      label: `Auto-categorize ${unassignedNodes.length} decisions`,
      type: "l3_auto_categorization",
      status: "pending",
      createdAt: new Date(),
    };

    this.tqProvider.addTask(task);

    void this.autoCategorizationHandler.runAutoCategorizationAsync(
      taskId,
      workspaceRoot,
      unassignedNodes
    );

    return taskId;
  }
}

// Alias for compatibility
export { TaskRunner as DocuviaTaskRunner };
