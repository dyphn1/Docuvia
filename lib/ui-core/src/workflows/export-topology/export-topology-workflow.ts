import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
  type TopologyExportOptions,
  type TopologyGraph,
} from "@workspace/contracts";
import {
  EXPORT_TOPOLOGY_EVENTS,
  EXPORT_TOPOLOGY_MESSAGES,
} from "./export-topology-messages.js";
import { appendExportTopologyLogLine } from "./export-topology-log-writer.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

/**
 * The `export-topology` workflow — gathers every graph/tag/decision row via `IGraphStore`'s bulk
 * read methods, then delegates the pure projection into `topology.json`'s shape to the Domain
 * Core's `ITopologyBuilder` (mirrors old Docuvia's `TopologyExportService.exportTopology`). File
 * writing (`topology.json`/`topology.html`) is the Presentation layer's job — this workflow only
 * returns the built `TopologyGraph`.
 */
export class ExportTopologyWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(
    options: TopologyExportOptions = {},
  ): Promise<TopologyGraph> {
    const { workspaceRoot, logger } = this;

    logger.info(EXPORT_TOPOLOGY_MESSAGES.EXPORTING);
    await appendExportTopologyLogLine(workspaceRoot, {
      event: EXPORT_TOPOLOGY_EVENTS.START,
      collapse: options.collapse ?? null,
    });

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    let store;
    try {
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: true,
      });
    } catch (err) {
      if (
        err instanceof DocuviaError &&
        err.code === ErrorCodes.DB_OPEN_FAILED
      ) {
        await appendExportTopologyLogLine(workspaceRoot, {
          event: EXPORT_TOPOLOGY_EVENTS.ERROR,
          message: EXPORT_TOPOLOGY_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(
          ErrorCodes.DB_OPEN_FAILED,
          EXPORT_TOPOLOGY_MESSAGES.DB_NOT_FOUND,
          err,
        );
      }
      throw err;
    }

    try {
      const topologyBuilder = docuviaFactory.resolve(TOKENS.TopologyBuilder, {
        logger,
      });
      const graph = topologyBuilder.build(
        {
          workspaceRoot,
          l2Rows: store.graph.getAllNodes(),
          linkRows: store.graph.getAllLinks(),
          l3Rows: store.l3.getAllExportable(),
          tagRows: store.tags.getAllTagLinks(),
        },
        options,
      );

      await appendExportTopologyLogLine(workspaceRoot, {
        event: EXPORT_TOPOLOGY_EVENTS.SUMMARY,
        nodeCount: graph.stats.nodeCount,
        linkCount: graph.stats.linkCount,
        groupCount: graph.stats.groupCount,
        collapsed: graph.collapsed,
      });

      return graph;
    } finally {
      await store.close();
    }
  }
}
