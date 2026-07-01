export interface DashboardPayload {
  tagCount: number;
  moduleCount: number;
  decisionCount: number;
  recentDecisions: Array<{ title: string; status: string; filePath: string }>;
  topModules: Array<{ name: string; decisionCount: number }>;
  pendingTaskCount: number;
  inProgressTaskCount: number;
  loadedAt: string | null;
  workspaceName: string;
}

export interface UpdateMessage {
  type: "update";
  data: DashboardPayload;
}

export interface OpenDecisionMessage {
  type: "openDecision";
  filePath: string;
}

export interface OpenChatMessage {
  type: "openChat";
}

export type WebviewMessage = UpdateMessage | OpenDecisionMessage | OpenChatMessage;
