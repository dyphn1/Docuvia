/** Error messages thrown by the fetch-backed remote sync client, wrapped as `DocuviaError`. */
export const RemoteApiMessages = {
  CLIENT_USED_BEFORE_INITIALIZE:
    "FetchRemoteSyncClient used before initialize() was called",
  FETCH_L2_NODES_FAILED: "Failed to fetch remote L2 nodes",
  fetchL2NodesFailedWithReason: (message: string) =>
    `Failed to fetch remote L2 nodes: ${message}`,
  FETCH_L2_NODES_INVALID_JSON:
    "Failed to fetch remote L2 nodes: response body was not valid JSON",
  FETCH_L2_NODES_INVALID_RESPONSE:
    "Failed to fetch remote L2 nodes: response body did not match the remote-node contract",
  SYNC_PUSH_FAILED: "Sync push failed",
  syncPushFailedWithReason: (message: string) => `Sync push failed: ${message}`,
  SYNC_PUSH_INVALID_JSON: "Sync push failed: response body was not valid JSON",
  SYNC_PUSH_INVALID_RESPONSE:
    "Sync push failed: response body did not match the sync-push contract",
} as const;
