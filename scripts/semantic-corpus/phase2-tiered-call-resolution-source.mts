import { performance } from "node:perf_hooks";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  MAX_FILE_SIZE_BYTES,
  isDiscoverableSourceFile,
  type AstImportDescriptor,
  type AstCallSiteShapeFact,
  type AstDeclaredDeclaration,
  type CallResolutionHypothesisWorkspaceInput,
  type ICallResolutionHypothesisService,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { AstProcessingService } from "../../lib/core/src/ast/ast-processing.service.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import {
  candidateTargetKeyForDeclaration,
  resolveDirectRelativeImportPath,
} from "../../lib/core/src/semantic/call-resolution-hypothesis-index.js";
import { git, hashSnapshot, materializeSnapshot } from "./snapshot.mts";
import {
  preflightSnapshotPaths,
  readSnapshotSourceFile,
} from "./phase0-snapshot-safety.mts";
import {
  canonicalHash,
  sha256,
  type Phase2CorpusSource,
  type Phase2FactFile,
} from "./phase2-tiered-call-resolution-support.mjs";
import type { Phase2EvaluationObservation } from "./phase2-tiered-call-resolution-evaluation.mjs";

export interface Phase2PinnedSnapshot {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly sourceDir: string;
  readonly snapshotHash: string;
}

export interface Phase2SnapshotSourceResult {
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly sourceFingerprint: string;
  readonly configurationHash: string;
  readonly observations: readonly Phase2EvaluationObservation[];
  readonly sourceFactFileCount: number;
  readonly sourceIndexComplete: boolean;
  readonly ownerInventoryCount: number;
  readonly incompleteOwnerInventoryCount: number;
  readonly callShapeMappedCount: number;
  readonly callShapeMissingCount: number;
  readonly generatedCandidateCount: number;
  readonly unmappedCandidateCount: number;
  readonly ambiguousCandidateMappingCount: number;
  readonly parsedCallFileCount: number;
  readonly parsedImportTargetFileCount: number;
  readonly parseFailureCount: number;
  readonly parseWallMs: number;
  readonly hypothesisWallMs: number;
  readonly hypothesisLatenciesMs: readonly number[];
}

interface CandidateAliasInfo {
  readonly aliases: Set<string>;
  declarationCount: number;
}

function candidateAlias(
  filePath: string,
  declaration: AstDeclaredDeclaration,
): string | null {
  if (!declaration.name) return null;
  const owner = declaration.owner;
  const container = ["class", "interface", "object"].includes(owner.kind)
    ? owner.name
    : null;
  return `${filePath}#${container ? `${container}.` : ""}${declaration.name}`;
}

function candidateAliasIndex(
  factRows: readonly Phase2FactFile[],
): ReadonlyMap<string, CandidateAliasInfo> {
  const byKey = new Map<string, CandidateAliasInfo>();
  for (const row of factRows) {
    for (const declaration of row.declaredTypeFacts.declarations) {
      const key = candidateTargetKeyForDeclaration(row.filePath, declaration);
      const alias = candidateAlias(row.filePath, declaration);
      if (!key || !alias) continue;
      const current = byKey.get(key) ?? {
        aliases: new Set<string>(),
        declarationCount: 0,
      };
      current.aliases.add(alias);
      current.declarationCount++;
      byKey.set(key, current);
    }
  }
  return byKey;
}

function aliasCollisionCounts(
  byKey: ReadonlyMap<string, CandidateAliasInfo>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const candidate of byKey.values())
    for (const alias of candidate.aliases)
      counts.set(alias, (counts.get(alias) ?? 0) + 1);
  return counts;
}

function addCandidateAliases(
  keys: readonly string[],
  byKey: ReadonlyMap<string, CandidateAliasInfo>,
  aliasesByName: ReadonlyMap<string, number>,
): { aliases: string[]; unmapped: number; ambiguous: number } {
  const aliases = new Set<string>();
  let unmapped = 0;
  let ambiguous = 0;
  for (const key of keys) {
    const info = byKey.get(key);
    if (!info) {
      unmapped++;
      continue;
    }
    if (info.aliases.size !== 1 || info.declarationCount !== 1) {
      ambiguous++;
      continue;
    }
    const [alias] = info.aliases;
    if (!alias || aliasesByName.get(alias) !== 1) {
      ambiguous++;
      continue;
    }
    aliases.add(alias);
  }
  return { aliases: [...aliases].sort(), unmapped, ambiguous };
}

export function mapCandidateKeysToUnambiguousAliases(
  keys: readonly string[],
  factRows: readonly Phase2FactFile[],
): { aliases: string[]; unmapped: number; ambiguous: number } {
  const byKey = candidateAliasIndex(factRows);
  return addCandidateAliases(keys, byKey, aliasCollisionCounts(byKey));
}

function sourceBytesForPath(
  snapshotRoot: string,
  filePath: string,
): {
  file: string;
  hash: string;
  code: string;
} | null {
  const inspected = readSnapshotSourceFile(
    snapshotRoot,
    filePath,
    MAX_FILE_SIZE_BYTES,
  );
  if (inspected.status === "excluded") return null;
  return {
    file: filePath,
    hash: sha256(inspected.bytes),
    code: inspected.bytes.toString("utf8"),
  };
}

function callShapesByPosition(
  callSites: readonly AstCallSiteShapeFact[],
): ReadonlyMap<string, readonly AstCallSiteShapeFact[]> {
  const result = new Map<string, AstCallSiteShapeFact[]>();
  for (const callSite of callSites) {
    const key = `${callSite.startLine}\0${callSite.startColumn}\0${callSite.calleeName}`;
    const existing = result.get(key) ?? [];
    existing.push(callSite);
    result.set(key, existing);
  }
  return result;
}

function lookupCallShape(
  index: ReadonlyMap<string, readonly AstCallSiteShapeFact[]> | undefined,
  source: Phase2CorpusSource,
): AstCallSiteShapeFact | undefined {
  if (!source.calleeName) return undefined;
  const key = `${source.line}\0${source.column}\0${source.calleeName}`;
  const matches = index?.get(key) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function isUnsupportedCallShape(
  fact: AstCallSiteShapeFact | undefined,
  callerHasFacts: boolean,
): boolean {
  return (
    !fact ||
    !callerHasFacts ||
    fact.calleeKind === "arg-chain" ||
    ((fact.calleeKind === "member" || fact.calleeKind === "this") &&
      fact.receiverBinding === null)
  );
}

function observationWithoutCall(
  source: Phase2CorpusSource,
): Phase2EvaluationObservation {
  return {
    sampleId: source.sampleId,
    split: source.split,
    duplicateGroup: source.duplicateGroup,
    repoFamily: source.repoFamily,
    snapshotId: source.snapshotId,
    repoId: source.repoId,
    ruleSignature: null,
    candidateTargetIds: [],
    topTargetId: null,
    topRankScore: null,
    tied: false,
    candidateSetComplete: false,
    truncated: false,
    unsupportedCallShape: true,
    calleeKind: "unmapped",
    generatedCandidateCount: 0,
    unmappedGeneratedCandidateCount: 0,
    proposedCandidateCount: 0,
  };
}

function observationFromResult(
  source: Phase2CorpusSource,
  callSite: AstCallSiteShapeFact,
  callerSourceContentHash: string | undefined,
  callerHasFacts: boolean,
  service: ICallResolutionHypothesisService,
  workspaceIndex: ReturnType<
    ICallResolutionHypothesisService["indexWorkspace"]
  >,
  aliasesByKey: ReadonlyMap<string, CandidateAliasInfo>,
  aliasesByName: ReadonlyMap<string, number>,
): {
  observation: Phase2EvaluationObservation;
  unmapped: number;
  ambiguous: number;
} {
  const result = service.hypothesize({
    callerFilePath: source.filePath,
    ...(callerSourceContentHash ? { callerSourceContentHash } : {}),
    callSite,
    workspaceIndex,
  });
  const generated = addCandidateAliases(
    result.generatedCandidateKeys,
    aliasesByKey,
    aliasesByName,
  );
  const top = result.candidates[0];
  const topInfo = top ? aliasesByKey.get(top.targetKey) : undefined;
  const topAlias = topInfo?.aliases.size === 1 ? [...topInfo.aliases][0] : null;
  const topTargetId =
    topAlias &&
    topInfo?.declarationCount === 1 &&
    aliasesByName.get(topAlias) === 1
      ? topAlias
      : null;
  return {
    observation: {
      sampleId: source.sampleId,
      split: source.split,
      duplicateGroup: source.duplicateGroup,
      repoFamily: source.repoFamily,
      snapshotId: source.snapshotId,
      repoId: source.repoId,
      calleeKind: callSite.calleeKind,
      ruleSignature: result.ruleSignature,
      candidateTargetIds: generated.aliases,
      topTargetId,
      topRankScore: top?.rankScore ?? null,
      tied:
        top !== undefined && result.candidates[1]?.rankScore === top.rankScore,
      candidateSetComplete: result.candidateSetComplete,
      truncated: result.truncated,
      unsupportedCallShape: isUnsupportedCallShape(callSite, callerHasFacts),
      generatedCandidateCount: result.generatedCandidateKeys.length,
      ambiguousCandidateMappingCount: generated.ambiguous,
      unmappedGeneratedCandidateCount: generated.unmapped,
      proposedCandidateCount: result.candidates.length,
      reason: result.reason,
    },
    unmapped: generated.unmapped,
    ambiguous: generated.ambiguous,
  };
}

function workspaceSourceFiles(
  factRows: readonly Phase2FactFile[],
  parsedByFile: ReadonlyMap<string, ParsedAstFileResult>,
): CallResolutionHypothesisWorkspaceInput["sourceFiles"] {
  return factRows.map(({ filePath, fileContentSha256, declaredTypeFacts }) => {
    const data = parsedByFile.get(filePath)?.data;
    return {
      filePath,
      sourceContentHash: fileContentSha256,
      imports: data?.imports,
      exports: data?.exports,
      callSiteShapeFacts: data?.callSiteShapeFacts ?? null,
      declaredTypeFacts,
    };
  });
}

function directAliasTargetPaths(
  callFiles: readonly ParsedAstFileResult[],
  factRows: readonly Phase2FactFile[],
): string[] {
  const factsByPath = new Map<string, Phase2FactFile[]>();
  for (const row of factRows) {
    const matches = factsByPath.get(row.filePath) ?? [];
    matches.push(row);
    factsByPath.set(row.filePath, matches);
  }
  const availablePaths = factRows.map(({ filePath }) => filePath);
  const targets = new Set<string>();
  for (const caller of callFiles) {
    const importsByLocalName = new Map<string, AstImportDescriptor[]>();
    for (const descriptor of caller.data.imports) {
      const descriptors = importsByLocalName.get(descriptor.localName) ?? [];
      descriptors.push(descriptor);
      importsByLocalName.set(descriptor.localName, descriptors);
    }
    for (const [localName, descriptors] of importsByLocalName) {
      if (descriptors.length !== 1) continue;
      const descriptor = descriptors[0];
      if (
        !descriptor ||
        descriptor.viaReexport ||
        descriptor.isTypeOnly ||
        descriptor.originalName === "*" ||
        descriptor.originalName === "default" ||
        descriptor.localName === descriptor.originalName
      )
        continue;
      const targetPath = resolveDirectRelativeImportPath(
        caller.file,
        descriptor.modulePath,
        availablePaths,
      );
      if (!targetPath || (factsByPath.get(targetPath)?.length ?? 0) !== 1)
        continue;
      if (isDiscoverableSourceFile(targetPath)) targets.add(targetPath);
    }
  }
  return [...targets].sort();
}

export function validateFactsAgainstSnapshot(
  snapshotRoot: string,
  snapshotHash: string,
  factRows: readonly Phase2FactFile[],
): void {
  const snapshot = hashSnapshot(snapshotRoot);
  if (snapshot.hash !== snapshotHash)
    throw new Error(
      "Materialized snapshot hash differs from the pinned input.",
    );
  for (const row of factRows) {
    const recorded = snapshot.files.get(row.filePath);
    if (recorded === row.fileContentSha256) continue;
    const bytes = readFileSync(path.join(snapshotRoot, row.filePath));
    if (sha256(bytes) !== row.fileContentSha256)
      throw new Error(`Phase 1 facts are stale for ${row.filePath}.`);
  }
}

export async function processPhase2Snapshot(input: {
  readonly snapshot: Phase2PinnedSnapshot;
  readonly repositoriesDirectory: string;
  readonly temporaryDirectory: string;
  readonly sourceRows: readonly Phase2CorpusSource[];
  readonly factRows: readonly Phase2FactFile[];
  readonly service: ICallResolutionHypothesisService;
  readonly processor: AstProcessingService;
  readonly factsSidecarHash: string;
}): Promise<Phase2SnapshotSourceResult> {
  const { snapshot } = input;
  const sourceDirectory = path.join(
    input.repositoriesDirectory,
    snapshot.sourceDir,
  );
  materializeSnapshot(
    sourceDirectory,
    snapshot.revision,
    snapshot.subtree,
    input.temporaryDirectory,
  );
  try {
    const factRows = input.factRows.filter(
      (row) => row.snapshotId === snapshot.snapshotId,
    );
    validateFactsAgainstSnapshot(
      input.temporaryDirectory,
      snapshot.snapshotHash,
      factRows,
    );
    const sourcePaths = [
      ...new Set(input.sourceRows.map((row) => row.filePath)),
    ].sort();
    const discovered = sourcePaths.flatMap((filePath) => {
      if (!isDiscoverableSourceFile(filePath)) return [];
      const source = sourceBytesForPath(input.temporaryDirectory, filePath);
      if (!source) return [];
      const expected = factRows.find((row) => row.filePath === filePath);
      if (expected && expected.fileContentSha256 !== source.hash)
        throw new Error(`Callsite source hash differs for ${filePath}.`);
      return [source];
    });
    const parseStarted = performance.now();
    const parsedCallFiles = await input.processor.processFiles(
      input.temporaryDirectory,
      discovered,
    );
    const callSourcePaths = new Set(discovered.map(({ file }) => file));
    const aliasTargetPaths = directAliasTargetPaths(
      parsedCallFiles.parsed,
      factRows,
    ).filter((filePath) => !callSourcePaths.has(filePath));
    const factRowsByPath = new Map<string, Phase2FactFile[]>();
    for (const row of factRows) {
      const matches = factRowsByPath.get(row.filePath) ?? [];
      matches.push(row);
      factRowsByPath.set(row.filePath, matches);
    }
    const discoveredAliasTargets = aliasTargetPaths.flatMap((filePath) => {
      const [expected] = factRowsByPath.get(filePath) ?? [];
      if (!expected || (factRowsByPath.get(filePath)?.length ?? 0) !== 1)
        return [];
      const source = sourceBytesForPath(input.temporaryDirectory, filePath);
      if (!source) return [];
      if (source.hash !== expected.fileContentSha256)
        throw new Error(`Imported target source hash differs for ${filePath}.`);
      return [source];
    });
    const parsedAliasTargets = discoveredAliasTargets.length
      ? await input.processor.processFiles(
          input.temporaryDirectory,
          discoveredAliasTargets,
        )
      : { parsed: [], failures: [] };
    const parseWallMs = performance.now() - parseStarted;
    const parsedByFile = new Map<string, ParsedAstFileResult>(
      [...parsedCallFiles.parsed, ...parsedAliasTargets.parsed].map((row) => [
        row.file,
        row,
      ]),
    );
    const sourceHashesByFile = new Map(
      [...discovered, ...discoveredAliasTargets].map(({ file, hash }) => [
        file,
        hash,
      ]),
    );
    const factsByFile = new Map(
      factRows.map((row) => [row.filePath, row.declaredTypeFacts]),
    );
    const aliasesByKey = candidateAliasIndex(factRows);
    const aliasesByName = aliasCollisionCounts(aliasesByKey);
    const sourceFingerprint = canonicalHash({
      snapshotHash: snapshot.snapshotHash,
      factsSidecarHash: input.factsSidecarHash,
      factFiles: factRows.map(({ filePath, fileContentSha256 }) => ({
        filePath,
        fileContentSha256,
      })),
      parsedInputs: [...discovered, ...discoveredAliasTargets].map(
        ({ file, hash }) => ({ file, hash }),
      ),
    });
    const workspaceIndex = input.service.indexWorkspace({
      sourceFingerprint,
      sourceIndexComplete: true,
      sourceFiles: workspaceSourceFiles(factRows, parsedByFile),
    });
    const callShapeMaps = new Map(
      [...parsedByFile].map(([file, row]) => [
        file,
        callShapesByPosition(row.data.callSiteShapeFacts?.callSites ?? []),
      ]),
    );
    const observations: Phase2EvaluationObservation[] = [];
    const hypothesisLatenciesMs: number[] = [];
    let callShapeMappedCount = 0;
    let callShapeMissingCount = 0;
    let generatedCandidateCount = 0;
    let unmappedCandidateCount = 0;
    let ambiguousCandidateMappingCount = 0;
    const hypothesisStarted = performance.now();
    for (const source of input.sourceRows) {
      const callSite = lookupCallShape(
        callShapeMaps.get(source.filePath),
        source,
      );
      if (!callSite || source.positionStatus !== "unique") {
        observations.push(observationWithoutCall(source));
        callShapeMissingCount++;
        continue;
      }
      callShapeMappedCount++;
      const started = performance.now();
      const result = observationFromResult(
        source,
        callSite,
        sourceHashesByFile.get(source.filePath),
        factsByFile.has(source.filePath),
        input.service,
        workspaceIndex,
        aliasesByKey,
        aliasesByName,
      );
      hypothesisLatenciesMs.push(performance.now() - started);
      observations.push(result.observation);
      generatedCandidateCount +=
        result.observation.generatedCandidateCount ?? 0;
      unmappedCandidateCount += result.unmapped;
      ambiguousCandidateMappingCount += result.ambiguous;
    }
    return {
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      sourceFingerprint: workspaceIndex.sourceFingerprint,
      configurationHash: workspaceIndex.configurationHash,
      observations,
      sourceFactFileCount: factRows.length,
      sourceIndexComplete: true,
      ownerInventoryCount: factRows.reduce(
        (count, row) => count + row.declaredTypeFacts.ownerInventories.length,
        0,
      ),
      incompleteOwnerInventoryCount: factRows.reduce(
        (count, row) =>
          count +
          row.declaredTypeFacts.ownerInventories.filter(
            (inventory) => !inventory.complete,
          ).length,
        0,
      ),
      callShapeMappedCount,
      callShapeMissingCount,
      generatedCandidateCount,
      unmappedCandidateCount,
      ambiguousCandidateMappingCount,
      parsedCallFileCount: parsedCallFiles.parsed.length,
      parsedImportTargetFileCount: parsedAliasTargets.parsed.length,
      parseFailureCount:
        parsedCallFiles.failures.length + parsedAliasTargets.failures.length,
      parseWallMs,
      hypothesisWallMs: performance.now() - hypothesisStarted,
      hypothesisLatenciesMs,
    };
  } finally {
    rmSync(input.temporaryDirectory, { recursive: true, force: true });
  }
}

export function makeAstProcessor(): AstProcessingService {
  return new AstProcessingService(new AstWorkerPool());
}
