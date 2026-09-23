import { createHash } from "node:crypto";
import type {
  SemanticCorpusManifest,
  SemanticCorpusReason,
  SemanticCorpusReport,
} from "@workspace/contracts";
import { labelCorpusSample } from "./semantic-corpus-labels.js";
import {
  CORPUS_ORIGINS,
  CORPUS_SPLITS,
  corpusMetrics,
  readyRealCounts,
  sufficientCorpusSize,
} from "./semantic-corpus-metrics.js";

/** JSON-only validated DTOs; array order is semantically meaningful. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function recallGate(
  recall: number | null,
): SemanticCorpusReport["gates"]["candidateRecall"] {
  if (recall === null) return "insufficient-evidence";
  return recall >= 0.99 ? "pass" : "fail";
}

export function auditCorpus(
  manifest: SemanticCorpusManifest,
): SemanticCorpusReport {
  const { samples, ...identity } = manifest;
  const results = samples.map(labelCorpusSample);
  const lookup = new Map(results.map((result) => [result.sampleId, result]));
  const reasons: Record<SemanticCorpusReason, number> = {
    ready: 0,
    "freshness-mismatch": 0,
    "label-conflict": 0,
    "out-of-scope": 0,
    "oracle-failure": 0,
    unreviewed: 0,
    "input-truncated": 0,
  };
  for (const result of results) reasons[result.reason]++;
  const real = corpusMetrics(
    samples.filter((s) => s.source.origin === "real"),
    lookup,
  );
  const synthetic = corpusMetrics(
    samples.filter((s) => s.source.origin === "synthetic"),
    lookup,
  );
  const independentReadyRealRequests = readyRealCounts(
    samples,
    lookup,
    "duplicateGroup",
  );
  const readyRealFamilies = readyRealCounts(samples, lookup, "repoFamily");
  return {
    ...identity,
    datasetHash: createHash("sha256")
      .update(canonicalJson(manifest), "utf8")
      .digest("hex"),
    results,
    reasons,
    real,
    synthetic,
    slices: CORPUS_ORIGINS.flatMap((origin) =>
      CORPUS_SPLITS.map((split) => ({
        origin,
        split,
        metrics: corpusMetrics(
          samples.filter(
            (s) => s.source.origin === origin && s.source.split === split,
          ),
          lookup,
        ),
      })),
    ),
    independentReadyRealRequests,
    readyRealFamilies,
    gates: {
      sampleSize: sufficientCorpusSize(
        independentReadyRealRequests,
        readyRealFamilies,
      )
        ? "pass"
        : "insufficient-evidence",
      candidateRecall: recallGate(real.candidateRecall),
    },
  };
}
