/** Remote Docuvia backend endpoint paths, relative to `RemoteSyncClientConfig.apiUrl` (see docs/gitbook/architecture/virtual-contracts-architecture.md's Technology Provider section). */
export const RemoteApiPaths = {
  l2Nodes: (projectId: string) => `/projects/${projectId}/l2-nodes`,
  SYNC_PUSH: "/sync/push",
} as const;
