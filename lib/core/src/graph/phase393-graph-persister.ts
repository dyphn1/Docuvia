import type {
  CallsProjectionCallerPolicy,
  ICallResolutionHypothesisService,
  IGraphPersister,
} from "@workspace/contracts";
import { DEFAULT_CALLS_PROJECTION_CALLER_POLICY as DEFAULT_CALLER_POLICY } from "@workspace/contracts";
import { GraphPersisterService as Phase6GraphPersisterService } from "./phase6-graph-persister.js";
import { persistDynamicDependencyEvidence } from "../impact/dynamic-dependency-evidence.js";

/**
 * Issue #393 evidence layer around the Phase 6 graph persister.
 *
 * Confirmed static dependencies remain the Phase 6 persister's responsibility. This wrapper scans
 * TS/JS source for runtime `import(expr)` boundaries after the normal graph write completes and
 * stores their bounded/unresolved evidence separately in `docuvia_meta`. No candidate is promoted
 * to a confirmed `node_links` edge.
 */
export class GraphPersisterService implements IGraphPersister {
  private readonly base: Phase6GraphPersisterService;

  constructor(
    hypothesisService?: ICallResolutionHypothesisService,
    callerPolicy: CallsProjectionCallerPolicy = DEFAULT_CALLER_POLICY,
  ) {
    this.base = new Phase6GraphPersisterService(
      hypothesisService,
      callerPolicy,
    );
  }

  public async persist(
    input: Parameters<IGraphPersister["persist"]>[0],
  ): Promise<Awaited<ReturnType<Phase6GraphPersisterService["persist"]>>> {
    const result = await this.base.persist(input);
    await input.store.withWriteLock(() =>
      input.store.withTransaction(() => {
        persistDynamicDependencyEvidence(
          input.store,
          input.workspaceRoot,
          input.projectId,
          input.parsedResults,
        );
      }),
    );
    return result;
  }
}
