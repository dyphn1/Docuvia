import type { IGraphStore } from "@workspace/contracts";

/** Removes every persisted Tier A record for a source path that left the current tree. */
export function retirePath(
  store: IGraphStore,
  projectId: number,
  file: string,
): void {
  store.withTransaction(() => {
    store.callSiteResolutions?.deleteForFile(projectId, file);
    store.graph.deleteNodesForPath(file);
    store.callSites.deleteForFile(projectId, file);
    store.files.deleteFile(projectId, file);
  });
}
