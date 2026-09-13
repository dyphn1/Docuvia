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

    const targetFile = store.graph.findNodeByName(target)?.filePath;
    if (!targetFile) return blastRadius;

    const seen = new Set(blastRadius.map((entry) => entry.name));
    blastRadius.push(
      ...this.resolveDynamicCandidateEntries(store, target, targetFile, seen),
    );
    return blastRadius;
  }

  public getDynamicEvidence(
    store: IGraphStore,
    target: string,
  ): DynamicDependencyEvidence[] {
    return dynamicEvidenceForTarget(store, target);
  }

  private resolveDynamicCandidateEntries(
    store: IGraphStore,
    target: string,
    targetFile: string,
    seen: Set<string>,
  ): BlastRadiusEntry[] {
    const entries: BlastRadiusEntry[] = [];
    for (const evidence of this.getDynamicEvidence(store, target)) {
      const entry = this.buildDynamicCandidateEntry(
        store,
        evidence,
        targetFile,
        seen,
      );
      if (!entry) continue;
      entries.push(entry);
      seen.add(entry.name);
    }
    return entries;
  }

  private buildDynamicCandidateEntry(
    store: IGraphStore,
    evidence: DynamicDependencyEvidence,
    targetFile: string,
    seen: ReadonlySet<string>,
  ): BlastRadiusEntry | undefined {
    if (!this.isCandidateForTarget(evidence, targetFile)) return undefined;
    if (evidence.sourceFile === targetFile || seen.has(evidence.sourceFile)) {
      return undefined;
    }

    const sourceNode = store.graph.findNodeByName(evidence.sourceFile);
    if (!sourceNode || sourceNode.name !== evidence.sourceFile)
      return undefined;
    const l3Rows = store.l3.getByL2NodeId(sourceNode.id);
    const why =
      l3Rows.length > 0
        ? l3Rows.map((row) => ({ title: row.title, content: row.content }))
        : undefined;
    return {
      name: sourceNode.name,
      type: sourceNode.type,
      edgeSource: BlastRadiusEdgeSources.DYNAMIC_CANDIDATE,
      dynamicEvidence: evidence,
      ...(why ? { why } : {}),
    };
  }

  private isCandidateForTarget(
    evidence: DynamicDependencyEvidence,
    targetFile: string,
  ): boolean {
    return (
      evidence.status === DynamicDependencyStatuses.BOUNDED &&
      evidence.candidatePaths.includes(targetFile)
    );
  }
}
