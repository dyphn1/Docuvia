import path from "node:path";
import { readFileSync } from "node:fs";
import {
  candidateOracleTargetMapping,
  filterInputsToUniqueOracleTargets,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import type { Phase2EvaluationObservation } from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  allFactRows,
  allSourceRows,
  canonicalHash,
  labelsForSplitIsolated,
  readJson,
  readJsonl,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
} from "./phase2-tiered-call-resolution-support.mjs";

interface CandidatePredictionManifest {
  readonly schemaVersion: 2;
  readonly measurement: "phase2-p2a-candidate-predictions/2";
  readonly candidateOracleMappingScope: "snapshotId+repoId";
  readonly predictionRows: number;
  readonly predictionSha256: string;
  readonly correctedFactsSha256: string;
  readonly candidateGeneratorVersion: string;
  readonly sourceInputHashes: Readonly<Record<string, string>>;
  readonly splitCounts: Readonly<Record<string, number>>;
}

interface CandidateTargetDeclaration {
  readonly kind: string;
  readonly name?: string | null;
  readonly declarationSpan?: { readonly start: number; readonly end: number };
  readonly owner: { readonly kind: string; readonly name?: string | null };
}

interface CandidateFactsFile {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly filePath: string;
  readonly fileContentSha256: string;
  readonly declaredTypeFacts: {
    readonly schemaVersion: number;
    readonly language: string;
    readonly declarations: readonly CandidateTargetDeclaration[];
  };
}

interface CandidateSourceRow {
  readonly sampleId: string;
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly repoFamily: string;
  readonly split: string;
  readonly duplicateGroup: string;
  readonly filePath: string;
  readonly line: number;
  readonly columnUtf16: number;
  readonly callSiteKey: string;
  readonly calleeKind: string;
  readonly calleeName: string | null;
  readonly receiverText: string | null;
  readonly receiverCategory: string;
  readonly positionStatus: string;
}

function parseOptions(args: readonly string[]): {
  readonly predictionsPath: string;
  readonly split: "train" | "calibration";
  readonly outputPath: string;
} {
  if (args.length !== 3 || !["train", "calibration"].includes(args[1] ?? ""))
    throw new Error(
      "Usage: phase2-tiered-call-resolution-candidate-miss-audit.mts <predictions.jsonl> <train|calibration> <out.json>",
    );
  return {
    predictionsPath: path.resolve(args[0]!),
    split: args[1] as "train" | "calibration",
    outputPath: path.resolve(args[2]!),
  };
}

function scopeFileKey(
  row: Pick<CandidateFactsFile, "snapshotId" | "repoId" | "filePath">,
): string {
  return JSON.stringify([row.snapshotId, row.repoId, row.filePath]);
}

function canonicalTargetId(targetId: string): string {
  return targetId.replace(/@L\d+(?:#\d+)?$/, "");
}

function targetDeclarations(
  targetId: string,
  source: Pick<CandidateSourceRow, "snapshotId" | "repoId">,
  factsByScopeFile: ReadonlyMap<string, CandidateFactsFile>,
): readonly CandidateTargetDeclaration[] {
  const canonical = canonicalTargetId(targetId);
  const separator = canonical.indexOf("#");
  if (separator < 0) return [];
  const filePath = canonical.slice(0, separator);
  const alias = canonical.slice(separator + 1);
  const factFile = factsByScopeFile.get(scopeFileKey({ ...source, filePath }));
  if (!factFile) return [];
  return factFile.declaredTypeFacts.declarations.filter((declaration) => {
    if (!declaration.name) return false;
    const container = ["class", "interface", "object"].includes(
      declaration.owner.kind,
    )
      ? declaration.owner.name
      : null;
    return `${container ? `${container}.` : ""}${declaration.name}` === alias;
  });
}

function targetFactsFile(
  targetId: string,
  source: Pick<CandidateSourceRow, "snapshotId" | "repoId">,
  factsByScopeFile: ReadonlyMap<string, CandidateFactsFile>,
): CandidateFactsFile | undefined {
  const canonical = canonicalTargetId(targetId);
  const separator = canonical.indexOf("#");
  if (separator < 0) return undefined;
  return factsByScopeFile.get(
    scopeFileKey({
      ...source,
      filePath: canonical.slice(0, separator),
    }),
  );
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = readJson<CandidatePredictionManifest>(
    path.join(
      path.dirname(options.predictionsPath),
      "candidate-prediction-manifest.json",
    ),
  );
  const predictionsSha256 = sha256(readFileSync(options.predictionsPath));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.measurement !== "phase2-p2a-candidate-predictions/2" ||
    manifest.candidateOracleMappingScope !== "snapshotId+repoId" ||
    manifest.predictionSha256 !== predictionsSha256
  )
    throw new Error(
      "Prediction artifact does not match a pinned scoped manifest.",
    );
  const verifiedSourceHashes = verifyPhase1SourceSidecars();
  for (const name of ["callsites.jsonl", "declared-type-facts-pass-a.jsonl"]) {
    if (
      !manifest.sourceInputHashes[name] ||
      manifest.sourceInputHashes[name] !== verifiedSourceHashes[name]
    )
      throw new Error(`Candidate source input hash changed for ${name}.`);
  }
  if (
    manifest.correctedFactsSha256 !==
    verifiedSourceHashes["declared-type-facts-pass-a.jsonl"]
  )
    throw new Error(
      "Candidate prediction manifest does not pin corrected facts.",
    );

  const allObservations = readJsonl<Phase2EvaluationObservation>(
    options.predictionsPath,
  );
  if (allObservations.length !== manifest.predictionRows)
    throw new Error("Prediction row count differs from its manifest.");
  const observations = allObservations.filter(
    (observation) => observation.split === options.split,
  );
  if (observations.length !== manifest.splitCounts[options.split])
    throw new Error("Prediction split count differs from its manifest.");
  const sampleIds = new Set(
    observations.map((observation) => observation.sampleId),
  );
  if (sampleIds.size !== observations.length)
    throw new Error("Prediction split contains duplicate sample IDs.");

  const [labels, sourceRows] = await Promise.all([
    labelsForSplitIsolated(options.split, sampleIds),
    Promise.resolve(allSourceRows()),
  ]);
  const scopedSources = sourceRows.filter(
    (source) => source.split === options.split,
  );
  const sourcesById = new Map(
    scopedSources.map((source) => [source.sampleId, source]),
  );
  if (
    sourcesById.size !== scopedSources.length ||
    scopedSources.length !== observations.length
  )
    throw new Error("Source rows do not uniquely cover the prediction split.");

  const facts = allFactRows();
  const factsByScopeFile = new Map(
    facts.map((fact) => [scopeFileKey(fact), fact]),
  );
  const mapping = candidateOracleTargetMapping(facts);
  const uniqueInputs = filterInputsToUniqueOracleTargets(
    observations,
    labels,
    mapping,
  );
  const predictionsById = new Map(
    observations.map((row) => [row.sampleId, row]),
  );
  const misses = [] as Record<string, unknown>[];
  const groups = new Map<
    string,
    {
      siteCount: number;
      missedTargetCount: number;
      zeroCandidateSiteCount: number;
    }
  >();

  for (const label of uniqueInputs.labels) {
    if (
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      continue;
    const observation = predictionsById.get(label.sampleId);
    const source = sourcesById.get(label.sampleId);
    if (!observation || !source)
      throw new Error(`Missing prediction/source row for ${label.sampleId}.`);
    const candidateIds = new Set(
      observation.candidateTargetIds.map(canonicalTargetId),
    );
    const missedTargetIds = label.positiveTargetIds.filter(
      (targetId) => !candidateIds.has(canonicalTargetId(targetId)),
    );
    if (missedTargetIds.length === 0) continue;
    const groupedTargets = missedTargetIds.map((targetId) => {
      const targetFactFile = targetFactsFile(
        targetId,
        source,
        factsByScopeFile,
      );
      const declarations = targetDeclarations(
        targetId,
        source,
        factsByScopeFile,
      );
      return {
        targetId,
        factFileFound: targetFactFile !== undefined,
        factFileContentSha256: targetFactFile?.fileContentSha256 ?? null,
        factFileLanguage: targetFactFile?.declaredTypeFacts.language ?? null,
        declarationFactCount: declarations.length,
        declarations,
      };
    });
    const predictionCallShape = observation.calleeKind ?? "unknown";
    const reasonClass = observation.reason
      ? observation.reason
      : observation.unsupportedCallShape || predictionCallShape === "unmapped"
        ? "call-shape-unmapped"
        : "unspecified";
    const key = JSON.stringify([
      source.repoFamily,
      source.calleeKind,
      predictionCallShape,
      reasonClass,
    ]);
    const group = groups.get(key) ?? {
      siteCount: 0,
      missedTargetCount: 0,
      zeroCandidateSiteCount: 0,
    };
    group.siteCount++;
    group.missedTargetCount += missedTargetIds.length;
    if (
      (observation.generatedCandidateCount ??
        observation.candidateTargetIds.length) === 0
    )
      group.zeroCandidateSiteCount++;
    groups.set(key, group);
    misses.push({
      sampleId: label.sampleId,
      snapshotId: source.snapshotId,
      repoId: source.repoId,
      revision: source.revision,
      repoFamily: source.repoFamily,
      duplicateGroup: label.duplicateGroup,
      callSiteKey: source.callSiteKey,
      filePath: source.filePath,
      line: source.line,
      columnUtf16: source.columnUtf16,
      calleeName: source.calleeName,
      calleeKind: source.calleeKind,
      receiverText: source.receiverText,
      receiverCategory: source.receiverCategory,
      positionStatus: source.positionStatus,
      observationReason: observation.reason ?? null,
      reasonClass,
      sourceCallShape: source.calleeKind,
      predictionCallShape,
      generatedCandidateCount:
        observation.generatedCandidateCount ??
        observation.candidateTargetIds.length,
      candidateTargetIds: observation.candidateTargetIds,
      unsupportedCallShape: observation.unsupportedCallShape,
      truncated: observation.truncated,
      candidateSetComplete: observation.candidateSetComplete,
      callerFacts: (() => {
        const caller = factsByScopeFile.get(
          scopeFileKey({
            snapshotId: source.snapshotId,
            repoId: source.repoId,
            filePath: source.filePath,
          }),
        );
        return caller
          ? {
              fileContentSha256: caller.fileContentSha256,
              language: caller.declaredTypeFacts.language,
              declarationFactCount:
                caller.declaredTypeFacts.declarations.length,
            }
          : null;
      })(),
      missedTargets: groupedTargets,
    });
  }

  const result = {
    schemaVersion: 1,
    measurement: "phase2-p2a-candidate-miss-source-audit/1",
    split: options.split,
    labelScope:
      "train/calibration only; heldout labels are never read by this tool",
    provenance: {
      predictionSha256: predictionsSha256,
      candidateGeneratorVersion: manifest.candidateGeneratorVersion,
      correctedFactsSha256: manifest.correctedFactsSha256,
      sourceInputHashes: verifiedSourceHashes,
      labelRowsHash: canonicalHash(
        [...labels].sort((left, right) =>
          left.sampleId.localeCompare(right.sampleId),
        ),
      ),
      uniqueOracleSnapshotScope: "snapshotId+repoId",
    },
    counts: {
      allPredictionSites: observations.length,
      confirmedPositiveSites: labels.filter(
        (label) =>
          label.reviewStatus === "confirmed" &&
          label.positiveTargetIds.length > 0,
      ).length,
      uniqueMappablePositiveSites: uniqueInputs.uniqueMappedPositiveSiteCount,
      uniqueMappablePositiveTargetOccurrences:
        uniqueInputs.uniqueMappedPositiveTargetOccurrenceCount,
      missSites: misses.length,
      missedPositiveTargetOccurrences: misses.reduce(
        (total, row) => total + (row.missedTargets as unknown[]).length,
        0,
      ),
      zeroCandidateMissSites: misses.filter(
        (row) => row.generatedCandidateCount === 0,
      ).length,
      candidateButMissSites: misses.filter(
        (row) => row.generatedCandidateCount !== 0,
      ).length,
    },
    byReasonFamilyAndShape: [...groups]
      .map(([key, value]) => {
        const [family, sourceCallShape, predictionCallShape, reasonClass] =
          JSON.parse(key) as [string, string, string, string];
        return {
          family,
          sourceCallShape,
          predictionCallShape,
          reasonClass,
          ...value,
        };
      })
      .sort(
        (left, right) =>
          left.family.localeCompare(right.family) ||
          left.sourceCallShape.localeCompare(right.sourceCallShape) ||
          left.predictionCallShape.localeCompare(right.predictionCallShape) ||
          left.reasonClass.localeCompare(right.reasonClass),
      ),
    rows: misses.sort((left, right) =>
      String(left.sampleId).localeCompare(String(right.sampleId)),
    ),
  };
  writeJson(options.outputPath, result);
  console.info(
    `[phase2-p2a] ${options.split}: ${misses.length} unique-mappable miss sites; wrote ${options.outputPath}`,
  );
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
