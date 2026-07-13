import type {
  BlastRadiusEntry,
  IGraphStore,
  IImpactService,
  ILogger,
  RiskLevel,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";

/**
 * Thresholds for the impacted-node count, modeled on GitNexus's own LOW/MEDIUM/HIGH/CRITICAL
 * scale (ported from old Docuvia's `change-detection-service.ts#IMPACT_RISK_THRESHOLDS`). Shared
 * by the standalone `docuvia impact <target>` command and `review`'s per-diff aggregate count so
 * the two never drift apart on what counts as "risky".
 */
export const IMPACT_RISK_THRESHOLDS = {
  HIGH_MIN: 6,
  CRITICAL_MIN: 21,
} as const;

/**
 * Blast-radius resolution + risk scoring — the "calculating blast radius"/"risk scoring" example
 * named directly in docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core
 * section. Built entirely on `IGraphStore`'s repo interfaces; if `lib/schema` is ever swapped for
 * another storage backend, this class is untouched.
 */
export class ImpactService implements IImpactService {
  constructor(private readonly logger: ILogger = createNoopLogger()) {}

  computeRiskLevel(impactedCount: number): RiskLevel {
    if (impactedCount >= IMPACT_RISK_THRESHOLDS.CRITICAL_MIN) return "CRITICAL";
    if (impactedCount >= IMPACT_RISK_THRESHOLDS.HIGH_MIN) return "HIGH";
    if (impactedCount >= 1) return "MEDIUM";
    return "LOW";
  }

  getBlastRadius(
    store: IGraphStore,
    target: string,
  ): BlastRadiusEntry[] | undefined {
    const node = store.graph.findNodeByName(target);
    if (!node) {
      this.logger.debug("No node resolved for impact target", { target });
      return undefined;
    }

    const blastRadius = store.graph
      .getIncomingEdges(node.id)
      .map(({ name, type }) => ({ name, type }));
    this.logger.debug("Resolved blast radius", {
      target,
      count: blastRadius.length,
    });
    return blastRadius;
  }
}
