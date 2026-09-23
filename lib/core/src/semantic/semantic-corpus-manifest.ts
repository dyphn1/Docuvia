import {
  DocuviaError,
  ErrorCodes,
  type SemanticCorpusManifest,
  type SemanticCorpusSample,
} from "@workspace/contracts";
import {
  hasKeys,
  isDataArray,
  isNonBlank,
  isRecord,
} from "./semantic-decision-shapes.js";
import {
  invalidCorpus,
  validateCorpusSample,
} from "./semantic-corpus-validation.js";

const MAX_SAMPLES = 100_000;

function requireUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) invalidCorpus(message);
}

function requireMapping(
  map: Map<string, string>,
  key: string,
  value: string,
  leakage: boolean,
): void {
  if (map.has(key) && map.get(key) !== value) {
    throw new DocuviaError(
      leakage
        ? ErrorCodes.SEMANTIC_CORPUS_LEAKAGE
        : ErrorCodes.SEMANTIC_CORPUS_INVALID,
      leakage
        ? "Corpus group crosses splits"
        : "Repository has inconsistent family identity",
    );
  }
  map.set(key, value);
}

function validatePartitions(samples: readonly SemanticCorpusSample[]): void {
  requireUnique(
    samples.map((s) => s.sampleId),
    "Duplicate corpus sample ID",
  );
  requireUnique(
    samples.map((s) =>
      JSON.stringify([
        s.source.repoId,
        s.source.projectId,
        s.source.callSiteId,
        s.source.snapshotHash,
      ]),
    ),
    "Duplicate corpus call-site snapshot",
  );
  const repos = new Map<string, string>();
  const families = new Map<string, string>();
  const fragments = new Map<string, string>();
  for (const { source } of samples) {
    requireMapping(repos, source.repoId, source.repoFamily, false);
    requireMapping(
      families,
      source.repoFamily,
      source.split === "temporal" ? "test" : source.split,
      true,
    );
    requireMapping(fragments, source.duplicateGroup, source.split, true);
    if (source.usage === "evaluation-only" && source.split === "train") {
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_CORPUS_LEAKAGE,
        "Evaluation-only source cannot enter training split",
      );
    }
  }
}

export function validateCorpusManifest(value: unknown): SemanticCorpusManifest {
  try {
    if (
      !isRecord(value) ||
      !hasKeys(value, [
        "schemaVersion",
        "corpusId",
        "corpusVersion",
        "splitSeed",
        "samples",
      ])
    )
      invalidCorpus("Invalid corpus manifest shape");
    if (
      value.schemaVersion !== 1 ||
      ![value.corpusId, value.corpusVersion, value.splitSeed].every(isNonBlank)
    )
      invalidCorpus("Invalid corpus manifest identity");
    const raw = value.samples;
    if (!Array.isArray(raw) || raw.length > MAX_SAMPLES || !isDataArray(raw))
      invalidCorpus("Invalid or oversized corpus sample list");
    const samples = raw
      .map(validateCorpusSample)
      .sort((a, b) =>
        a.sampleId < b.sampleId ? -1 : a.sampleId > b.sampleId ? 1 : 0,
      );
    validatePartitions(samples);
    return {
      schemaVersion: 1,
      corpusId: value.corpusId as string,
      corpusVersion: value.corpusVersion as string,
      splitSeed: value.splitSeed as string,
      samples,
    };
  } catch (cause) {
    throw DocuviaError.wrap(
      ErrorCodes.SEMANTIC_CORPUS_INVALID,
      "Invalid corpus manifest",
      cause,
    );
  }
}
