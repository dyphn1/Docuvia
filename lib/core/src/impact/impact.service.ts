import type {
  BlastRadiusEntry,
  IGraphStore,
  IImpactService,
  ILogger,
  RiskLevel,
} from "@workspace/contracts";
import { createNoopLogger, RiskLevels } from "@workspace/contracts";

const ImpactMessages = {
  NO_NODE_RESOLVED: "No node resolved for impact target",
  RESOLVED_BLAST_RADIUS: "Resolved blast radius",
} as const;

/**
 * Absolute-count FLOORS `computeRiskLevel()`'s scaled thresholds can never fall below -- the
 * exact original flat thresholds (ported from old Docuvia's
 * `change-detection-service.ts#IMPACT_RISK_THRESHOLDS`, modeled on GitNexus's own
 * LOW/MEDIUM/HIGH/CRITICAL scale). Kept as the same name/values through the
 * impact-risk-thresholds-not-scaled-to-repo-size fix
 * (docs/ai_plans/implement_scale-impact-risk-thresholds.md) -- every repo at or below
 * IMPACT_RISK_REFERENCE_NODE_COUNT classifies identically to before this fix, byte-for-byte.
 * Shared by the standalone `docuvia impact <target>` command and `review`'s per-diff aggregate
 * count so the two never drift apart on what counts as "risky".
 */
export const IMPACT_RISK_THRESHOLDS = {
  HIGH_MIN: 6,
  CRITICAL_MIN: 21,
} as const;

/**
 * `l2_nodes` count the floors above were empirically correct for -- nest's own measured graph
 * size (16,159 l2_nodes, typescript-cli-benchmark.md's `impact "Injectable"` row: 9 impacted ->
 * HIGH, the one impact-risk classification result the benchmark series never flagged as wrong).
 * Rounded to a clean constant, not the exact 16,159, to avoid implying false precision -- this is
 * a calibration anchor, not a live measurement of any specific repo. Repos at or below this size
 * get exactly IMPACT_RISK_THRESHOLDS' flat 6/21; above it, thresholds grow by
 * sqrt(l2Nodes / this) -- sub-linear, so the bar rises with repo size without becoming
 * unreachable on very large graphs. See docs/ai_plans/implement_scale-impact-risk-thresholds.md's
 * §3.1 for the full nest/vscode derivation and why sqrt was chosen over a flat percentage.
 */
export const IMPACT_RISK_REFERENCE_NODE_COUNT = 16_000;

function scaledRiskThreshold(floor: number, totalNodeCount: number): number {
  if (totalNodeCount <= IMPACT_RISK_REFERENCE_NODE_COUNT) return floor;
  const scaleFactor = Math.sqrt(
    totalNodeCount / IMPACT_RISK_REFERENCE_NODE_COUNT,
  );
  return Math.max(floor, Math.round(floor * scaleFactor));
}

/**
 * Pure banding formula, deliberately split out of `ImpactService.computeRiskLevel()` so the
 * scaling math itself is directly unit-testable without a real/mocked `IGraphStore` (mirrors
 * `resolveTierBCoverageHint()`'s own "pure logic, cheapest tests in the plan" precedent).
 */
export function computeRiskLevelFromCounts(
  impactedCount: number,
  totalNodeCount: number,
): RiskLevel {
  const criticalMin = scaledRiskThreshold(
    IMPACT_RISK_THRESHOLDS.CRITICAL_MIN,
    totalNodeCount,
  );
  const highMin = scaledRiskThreshold(
    IMPACT_RISK_THRESHOLDS.HIGH_MIN,
    totalNodeCount,
  );
  if (impactedCount >= criticalMin) return RiskLevels.CRITICAL;
  if (impactedCount >= highMin) return RiskLevels.HIGH;
  if (impactedCount >= 1) return RiskLevels.MEDIUM;
  return RiskLevels.LOW;
}

/**
 * Blast-radius resolution + risk scoring — the "calculating blast radius"/"risk scoring" example
 * named directly in docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core
 * section. Built entirely on `IGraphStore`'s repo interfaces; if `lib/schema` is ever swapped for
 * another storage backend, this class is untouched.
 */
export class ImpactService implements IImpactService {
  constructor(private readonly logger: ILogger = createNoopLogger()) {}

  computeRiskLevel(store: IGraphStore, impactedCount: number): RiskLevel {
    const { l2Nodes } = store.graph.count();
    return computeRiskLevelFromCounts(impactedCount, l2Nodes);
  }

  getBlastRadius(
    store: IGraphStore,
    target: string,
  ): BlastRadiusEntry[] | undefined {
    const node = store.graph.findNodeByName(target);
    if (!node) {
      this.logger.debug(ImpactMessages.NO_NODE_RESOLVED, { target });
      return undefined;
    }

    const blastRadius = store.graph
      .getIncomingEdges(node.id)
      .map(({ id, name, type }) => {
        const l3Rows = store.l3.getByL2NodeId(id);
        const why =
          l3Rows.length > 0
            ? l3Rows.map((row) => ({ title: row.title, content: row.content }))
            : undefined;
        return why ? { name, type, why } : { name, type };
      });
    this.logger.debug(ImpactMessages.RESOLVED_BLAST_RADIUS, {
      target,
      count: blastRadius.length,
    });
    return blastRadius;
  }
}
