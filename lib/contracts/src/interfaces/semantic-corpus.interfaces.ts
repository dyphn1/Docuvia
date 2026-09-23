/** Offline Phase 1 observations. No model/runtime or storage types cross this boundary. */
export type SemanticCorpusSplit = "train" | "calibration" | "test" | "temporal";
export type SemanticCorpusLabel =
  "confirmed-positive" | "confirmed-negative" | "unresolved" | "out-of-scope";
export type SemanticCorpusReason =
  | "ready"
  | "freshness-mismatch"
  | "label-conflict"
  | "out-of-scope"
  | "oracle-failure"
  | "unreviewed"
  | "input-truncated";

export interface SemanticCorpusSample {
  readonly schemaVersion: 1;
  readonly sampleId: string;
  readonly source: {
    readonly repoId: string;
    readonly repoFamily: string;
    readonly revision: string;
    readonly projectId: string;
    readonly callSiteId: string;
    readonly snapshotHash: string;
    /** Collector-assigned cluster covering clones, fragments and neighboring revisions. */
    readonly duplicateGroup: string;
    readonly license: string;
    readonly usage: "evaluation-only" | "training-and-evaluation";
    readonly origin: "real" | "synthetic";
    readonly split: SemanticCorpusSplit;
    readonly language: string;
    readonly relation: string;
  };
  readonly candidates: readonly {
    readonly id: string;
    readonly targetId: string;
  }[];
  readonly truncated: boolean;
  readonly oracle: {
    readonly status:
      "resolved" | "timeout" | "empty" | "not-ready" | "unsupported" | "error";
    readonly server: string;
    readonly version: string;
    readonly configHash: string;
    readonly snapshotHash: string;
    readonly targetIds: readonly string[];
  };
  readonly review: {
    readonly status: "confirmed" | "unreviewed" | "conflict" | "out-of-scope";
    readonly snapshotHash: string;
    readonly positiveTargetIds: readonly string[];
    readonly negativeTargetIds: readonly string[];
    readonly evidenceRefs: readonly string[];
  };
}

export interface SemanticCorpusLabelResult {
  readonly sampleId: string;
  readonly reason: SemanticCorpusReason;
  readonly labels: readonly {
    readonly candidateId: string;
    readonly targetId: string;
    readonly label: SemanticCorpusLabel;
  }[];
  readonly goldTargetIds: readonly string[];
  readonly missingTargetIds: readonly string[];
}

export interface ISemanticCorpusService {
  label(sample: unknown): SemanticCorpusLabelResult;
}
