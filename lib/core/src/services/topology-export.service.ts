import { TopologyGraph } from "../types/topology.types.js";
import { TopologyCollapseMode } from "../types/topology.types.js";
import { logger } from "../utils/logger.js";

export class TopologyExportService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public exportTopology(options: { collapse?: TopologyCollapseMode }): TopologyGraph {
    logger.info({ options }, "Exporting topology");
    return {
      nodes: [],
      links: [],
      groups: [],
      collapsed: false,
      stats: { nodeCount: 0, linkCount: 0, groupCount: 0 },
    };
  }
}
