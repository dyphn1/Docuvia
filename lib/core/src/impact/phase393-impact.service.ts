import {
  BlastRadiusEdgeSources,
  DynamicDependencyStatuses,
  type BlastRadiusEntry,
  type DynamicDependencyEvidence,
  type IGraphStore,
} from "@workspace/contracts";
import { ImpactService as Phase6ImpactService } from "./phase6-impact.service.js";
import { dynamicEvidenceForTarget } from "./dynamic-dependency-evidence.js";

/**
 * Issue #393 impact layer. Static/Phase-6 edges remain authoritative; bounded runtime-import
 * candidates are additive lower-confidence entries carrying explicit provenance. Unresolved
 * evidence is exposed through `getDynamicEvidence()` only and never fabricated into a caller.
 */
export class ImpactService extends Phase6ImpactService {
  public override getBlastRadius(
    store: IGraphStore,
    target: string,
  ): BlastRadiusEntry[] | undefined {
    const blastRadius = super.getBlastRadius(store, target);
    if (!blastRadius) return undefined;

    const targetNode = store.graph.findNodeByName(target);
    if (!targetNode?.filePath) return blastRadius;

    const seen = new Set(blastRadius.map((entry) => entry.name));
    for (const evidence of this.getDynamicEvidence(store, target)) {
      if (evidence.status !== DynamicDependencyStatuses.BOUNDED) continue;
      if (!evidence.candidatePaths.includes(targetNode.filePath)) continue;
      if (evidence.sourceFile === targetNode.filePath) continue;
      if (seen.has(evidence.sourceFile)) continue;

      const sourceNode = store.graph.findNodeByName(evidence.sourceFile);
      if (!sourceNode || sourceNode.name !== evidence.sourceFile) continue;
      const l3Rows = store.l3.getByL2NodeId(sourceNode.id);
      const why =
        l3Rows.length > 0
          ? l3Rows.map((row) => ({ title: row.title, content: row.content }))
          : undefined;
      blastRadius.push({
        name: sourceNode.name,
        type: sourceNode.type,
        edgeSource: BlastRadiusEdgeSources.DYNAMIC_CANDIDATE,
        dynamicEvidence: evidence,
        ...(why ? { why } : {}),
      });
      seen.add(evidence.sourceFile);
    }

    return blastRadius;
  }

  public getDynamicEvidence(
    store: IGraphStore,
    target: string,
  ): DynamicDependencyEvidence[] {
    return dynamicEvidenceForTarget(store, target);
  }
}
