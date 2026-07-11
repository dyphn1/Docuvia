/** Result of the `snapshot` workflow — mirrors `SnapshotRenderResult` plus the branch it was packed onto. */
export interface SnapshotResult {
  nodesWritten: number;
  edgesWritten: number;
  markdownFilesWritten: number;
}
