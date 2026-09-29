import type {
  SemanticCollectionCallSite,
  SemanticCorpusSample,
  SemanticCorpusSplit,
  SemanticDeclarationRef,
  SemanticOracleOutcome,
  SemanticSourceAuditResult,
  SemanticTierACandidateSet,
} from "@workspace/contracts";

export interface CorpusSampleParts {
  readonly repo: {
    readonly repoId: string;
    readonly repoFamily: string;
    readonly revision: string;
    readonly license: string;
    readonly usage: "evaluation-only" | "training-and-evaluation";
  };
  readonly projectId: string;
  readonly callSite: SemanticCollectionCallSite;
  /** Recomputed independently by the collection, oracle and review stages (C-01). */
  readonly snapshotHashes: {
    readonly source: string;
    readonly oracle: string;
    readonly review: string;
  };
  readonly duplicateGroup: string;
  readonly split: SemanticCorpusSplit;
  readonly candidates: SemanticTierACandidateSet;
  readonly oracle: SemanticOracleOutcome & {
    readonly server: string;
    readonly version: string;
    readonly configHash: string;
  };
  readonly checker: {
    readonly version: string;
    readonly declarations: readonly {
      readonly nodeKey: string;
      readonly ref: SemanticDeclarationRef;
    }[];
  };
  readonly audit: SemanticSourceAuditResult;
}

const REVISION_PREFIX = 12;
const STATIC_BINDING_KIND = "bare";

export function callSiteId(callSite: SemanticCollectionCallSite): string {
  return `${callSite.filePath}:${callSite.line}:${callSite.column}`;
}

function auditRef(audit: SemanticSourceAuditResult): string {
  return audit.kind === "not-applicable"
    ? `source-audit:not-applicable:${audit.reason}`
    : `source-audit:${audit.kind}:${audit.filePath}`;
}

function crossFile(parts: CorpusSampleParts) {
  return parts.checker.declarations.filter(
    (d) => d.ref.filePath !== parts.callSite.filePath,
  );
}

/** C-04: negatives only when static binding is certain (bare call, concrete declarations). */
function negatives(parts: CorpusSampleParts, positives: string[]): string[] {
  const certain =
    parts.callSite.calleeKind === STATIC_BINDING_KIND &&
    parts.checker.declarations.every((d) => d.ref.concrete);
  if (!certain) return [];
  return parts.candidates.candidates
    .map((c) => c.targetId)
    .filter((id) => !positives.includes(id));
}

function evidenceRefs(parts: CorpusSampleParts): string[] {
  const checker = crossFile(parts).map(
    (d) =>
      `ts-checker:typescript@${parts.checker.version}:${d.ref.filePath}:L${d.ref.nameLine}`,
  );
  return [...new Set([...checker, auditRef(parts.audit)])];
}

/** Assembles one P1-01 corpus sample from independently collected parts. */
export function buildCorpusSample(
  parts: CorpusSampleParts,
): SemanticCorpusSample {
  const positives = [...new Set(crossFile(parts).map((d) => d.nodeKey))].sort();
  const { repo, oracle } = parts;
  return {
    schemaVersion: 1,
    sampleId: `${repo.repoId}@${repo.revision.slice(0, REVISION_PREFIX)}::${callSiteId(parts.callSite)}`,
    source: {
      repoId: repo.repoId,
      repoFamily: repo.repoFamily,
      revision: repo.revision,
      projectId: parts.projectId,
      callSiteId: callSiteId(parts.callSite),
      snapshotHash: parts.snapshotHashes.source,
      duplicateGroup: parts.duplicateGroup,
      license: repo.license,
      usage: repo.usage,
      origin: "real",
      split: parts.split,
      language: "typescript",
      relation: "cross-file-call",
    },
    candidates: parts.candidates.candidates.map((c) => ({ ...c })),
    truncated: parts.candidates.truncated,
    oracle: {
      status: oracle.status,
      server: oracle.server,
      version: oracle.version,
      configHash: oracle.configHash,
      snapshotHash: parts.snapshotHashes.oracle,
      targetIds: [...oracle.targetIds],
    },
    review: {
      status: parts.audit.kind === "mismatch" ? "conflict" : "confirmed",
      snapshotHash: parts.snapshotHashes.review,
      positiveTargetIds: positives,
      negativeTargetIds: negatives(parts, positives),
      evidenceRefs: evidenceRefs(parts),
    },
  };
}
