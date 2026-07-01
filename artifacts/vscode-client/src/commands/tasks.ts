import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";

export function clearCompletedTasksCommand(tqProvider: TaskQueueTreeProvider) {
  tqProvider.clearCompleted();
}
