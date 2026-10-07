import { performance } from "node:perf_hooks";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  MAX_FILE_SIZE_BYTES,
  isDiscoverableSourceFile,
  type AstImportDescriptor,
  type AstReexportDescriptor,
  type AstCallSiteShapeFact,
  type AstDeclaredDeclaration,
  type CallResolutionConfiguredPathAliases,
  type CallResolutionHypothesisWorkspaceInput,
  type ICallResolutionHypothesisService,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { AstProcessingService } from "../../lib/core/src/ast/ast-processing.service.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import type {
  CallResolutionCandidateStageTrace,
  CallResolutionHypothesisService,
} from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import {
  candidateTargetKeyForExportedValue,
  candidateTargetKeyForDeclaration,
  resolveDirectConfiguredImportPath,
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
import {
  createCandidateStageEvidence,
  type CandidateStageEvidence,
  type CandidateTargetMapping,
} from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import {
  createProposalFilterStageEvidence,
  type ProposalFilterStageEvidence,
} from "./phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";

export interface Phase2PinnedSnapshot {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly sourceDir: string;
  readonly snapshotHash: string;
}

export function rankingSignalsForTopCandidate(
  candidates: readonly { readonly rankingSignals: readonly string[] }[],
): readonly string[] {
  return candidates[0]?.rankingSignals ?? [];
}

export interface Phase2SnapshotSourceResult {
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly sourceFingerprint: string;
  readonly configurationHash: string;
  readonly observations: readonly Phase2EvaluationObservation[];
  readonly candidateStageEvidence?: readonly CandidateStageEvidence[];
  readonly proposalFilterStageEvidence?: readonly ProposalFilterStageEvidence[];
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
  readonly parsedExportSourceFileCount: number;
  readonly parseFailureCount: number;
  readonly parseWallMs: number;
  readonly hypothesisWallMs: number;
  readonly hypothesisLatenciesMs: readonly number[];
}

interface CandidateAliasInfo {
  readonly aliases: Set<string>;
  declarationCount: number;
}

type CandidateStageTraceService = ICallResolutionHypothesisService &
  Pick<CallResolutionHypothesisService, "hypothesizeWithCandidateStageTrace">;

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
  parsedByFile: ReadonlyMap<string, ParsedAstFileResult> = new Map(),
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
    for (const exported of parsedByFile.get(row.filePath)?.data.exports ?? []) {
      if (exported.type !== "variable") continue;
      const key = candidateTargetKeyForExportedValue(
        row.filePath,
        exported.name,
      );
      if (byKey.has(key)) continue;
      byKey.set(key, {
        aliases: new Set([`${row.filePath}#${exported.name}`]),
        declarationCount: 1,
      });
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

function candidateListAliases(
  keys: readonly string[],
  byKey: ReadonlyMap<string, CandidateAliasInfo>,
): string[] {
  const aliases = new Set<string>();
  for (const key of keys) {
    const info = byKey.get(key);
    if (info?.aliases.size !== 1) continue;
    const [alias] = info.aliases;
    if (alias) aliases.add(alias);
  }
  return [...aliases].sort();
}

function candidateTargetMappingForKey(
  key: string,
  byKey: ReadonlyMap<string, CandidateAliasInfo>,
  aliasesByName: ReadonlyMap<string, number>,
): CandidateTargetMapping {
  const info = byKey.get(key);
  if (!info)
    return {
      status: "unmapped",
      targetId: null,
      reason: "candidate-key-not-in-pinned-facts",
    };
  if (info.aliases.size !== 1 || info.declarationCount !== 1)
    return {
      status: "ambiguous",
      targetId: null,
      reason: "candidate-key-has-multiple-source-declarations",
    };
  const [alias] = info.aliases;
  if (!alias || aliasesByName.get(alias) !== 1)
    return {
      status: "ambiguous",
      targetId: null,
      reason: "candidate-alias-is-not-unique-in-pinned-facts",
    };
  return { status: "mapped", targetId: alias, reason: null };
}

export function mapCandidateKeysToUnambiguousAliases(
  keys: readonly string[],
  factRows: readonly Phase2FactFile[],
  parsedByFile: ReadonlyMap<string, ParsedAstFileResult> = new Map(),
): { aliases: string[]; unmapped: number; ambiguous: number } {
  const byKey = candidateAliasIndex(factRows, parsedByFile);
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
    callerFilePath: source.filePath,
    revision: source.revision,
    ruleSignature: null,
    candidateTargetIds: [],
    proposedCandidateTargetIds: [],
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

function candidateStageCallSiteInputHash(
  source: Phase2CorpusSource,
  sourceContentHash: string,
  callSite: AstCallSiteShapeFact | null,
): string {
  return canonicalHash({
    sampleId: source.sampleId,
    callSiteId: source.callSiteId,
    filePath: source.filePath,
    line: source.line,
    column: source.column,
    calleeName: source.calleeName,
    positionStatus: source.positionStatus,
    sourceContentHash,
    callSiteShapeFact: callSite,
  });
}

function observationFromResult(
  source: Phase2CorpusSource,
  callSite: AstCallSiteShapeFact,
  callerSourceContentHash: string | undefined,
  callerHasFacts: boolean,
  service: CandidateStageTraceService,
  workspaceIndex: ReturnType<
    ICallResolutionHypothesisService["indexWorkspace"]
  >,
  aliasesByKey: ReadonlyMap<string, CandidateAliasInfo>,
  aliasesByName: ReadonlyMap<string, number>,
  candidateStageContext?: {
    readonly sourceContentHash: string;
    readonly callSiteInputHash: string;
    readonly captureProposalFilterStages: boolean;
  },
): {
  observation: Phase2EvaluationObservation;
  candidateStageEvidence?: CandidateStageEvidence;
  proposalFilterStageEvidence?: ProposalFilterStageEvidence;
  unmapped: number;
  ambiguous: number;
} {
  const request = {
    callerFilePath: source.filePath,
    ...(callerSourceContentHash ? { callerSourceContentHash } : {}),
    callSite,
    workspaceIndex,
  };
  let result: ReturnType<ICallResolutionHypothesisService["hypothesize"]>;
  let proposalFilterTrace: CallResolutionCandidateStageTrace | undefined;
  if (candidateStageContext?.captureProposalFilterStages) {
    const traced = service.hypothesizeWithCandidateStageTrace(request);
    result = traced.result;
    proposalFilterTrace = traced.candidateStageTrace;
  } else result = service.hypothesize(request);
  const generated = addCandidateAliases(
    result.generatedCandidateKeys,
    aliasesByKey,
    aliasesByName,
  );
  const proposedAliases = candidateListAliases(
    result.candidates.map(({ targetKey }) => targetKey),
    aliasesByKey,
  );
  const generatedListAliases = candidateListAliases(
    result.generatedCandidateKeys,
    aliasesByKey,
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
  const candidateStageEvidence = candidateStageContext
    ? createCandidateStageEvidence(
        {
          sampleId: source.sampleId,
          split: source.split,
          sourceContentHash: candidateStageContext.sourceContentHash,
          callSiteInputHash: candidateStageContext.callSiteInputHash,
          generatedCandidateKeys: result.generatedCandidateKeys,
          orderedProposalKeys: result.candidates.map(
            (candidate) => candidate.targetKey,
          ),
        },
        (key) => candidateTargetMappingForKey(key, aliasesByKey, aliasesByName),
      )
    : undefined;
  const proposalFilterStageEvidence =
    candidateStageContext?.captureProposalFilterStages && proposalFilterTrace
      ? createProposalFilterStageEvidence(
          {
            sampleId: source.sampleId,
            split: source.split,
            sourceContentHash: candidateStageContext.sourceContentHash,
            callSiteInputHash: candidateStageContext.callSiteInputHash,
            candidateKeysByStage: proposalFilterTrace,
          },
          (key) =>
            candidateTargetMappingForKey(key, aliasesByKey, aliasesByName),
        )
      : undefined;
  if (
    candidateStageEvidence &&
    JSON.stringify(candidateStageEvidence.mappedCandidateTargetIds) !==
      JSON.stringify(generated.aliases)
  )
    throw new Error(
      `Candidate-stage mapping differs from the pinned v4 target mapping at ${source.sampleId}: evidence=${JSON.stringify(candidateStageEvidence.mappedCandidateTargetIds)}; v4=${JSON.stringify(generated.aliases)}.`,
    );
  return {
    observation: {
      sampleId: source.sampleId,
      split: source.split,
      duplicateGroup: source.duplicateGroup,
      repoFamily: source.repoFamily,
      snapshotId: source.snapshotId,
      repoId: source.repoId,
      callerFilePath: source.filePath,
      revision: source.revision,
      calleeKind: callSite.calleeKind,
      ruleSignature: result.ruleSignature,
      candidateTargetIds: generated.aliases,
      generatedCandidateTargetIds: generatedListAliases,
      proposedCandidateTargetIds: proposedAliases,
      topTargetId,
      topRankScore: top?.rankScore ?? null,
      topRankingSignals: rankingSignalsForTopCandidate(result.candidates),
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
    ...(candidateStageEvidence ? { candidateStageEvidence } : {}),
    ...(proposalFilterStageEvidence ? { proposalFilterStageEvidence } : {}),
    unmapped: generated.unmapped,
    ambiguous: generated.ambiguous,
  };
}

function workspaceSourceFiles(
  factRows: readonly Phase2FactFile[],
  parsedByFile: ReadonlyMap<string, ParsedAstFileResult>,
  excludeCombinedDefaultImports = false,
  includeQ3ReceiverFacts = false,
): CallResolutionHypothesisWorkspaceInput["sourceFiles"] {
  return factRows.map(({ filePath, fileContentSha256, declaredTypeFacts }) => {
    const data = parsedByFile.get(filePath)?.data;
    const imports = importsForDefaultImportCapability(
      data?.imports,
      !excludeCombinedDefaultImports,
    );
    const q3ReceiverFacts = includeQ3ReceiverFacts
      ? data?.declaredTypeFacts?.q3ReceiverFacts
      : undefined;
    return {
      filePath,
      sourceContentHash: fileContentSha256,
      imports,
      exports: data?.exports,
      reexports: data?.reexports,
      callSiteShapeFacts: data?.callSiteShapeFacts ?? null,
      declaredTypeFacts: q3ReceiverFacts
        ? { ...declaredTypeFacts, q3ReceiverFacts }
        : declaredTypeFacts,
    };
  });
}

export function importsForDefaultImportCapability(
  imports: readonly AstImportDescriptor[] | undefined,
  enabled = false,
): readonly AstImportDescriptor[] | undefined {
  return imports?.filter(
    (descriptor) => enabled || descriptor.isCombinedDefaultImport !== true,
  );
}

interface ImportTargetSourceFile {
  readonly file: string;
  readonly data: { readonly imports: readonly AstImportDescriptor[] };
}

export function directImportTargetPaths(
  callFiles: readonly ImportTargetSourceFile[],
  factRows: readonly Phase2FactFile[],
  configuredPathAliases?: CallResolutionConfiguredPathAliases,
  options: {
    readonly includeCombinedDefaultImports?: boolean;
    readonly includeUnaliasedNamedImports?: boolean;
    readonly includeTypeOnlyImports?: boolean;
  } = {},
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
    for (const descriptors of importsByLocalName.values()) {
      if (descriptors.length !== 1) continue;
      const descriptor = descriptors[0];
      const isCombinedDefaultImport =
        descriptor?.isCombinedDefaultImport === true &&
        descriptor.originalName === "default";
      if (
        !descriptor ||
        descriptor.viaReexport ||
        (descriptor.isTypeOnly && options.includeTypeOnlyImports !== true) ||
        (isCombinedDefaultImport &&
          options.includeCombinedDefaultImports !== true) ||
        (!isCombinedDefaultImport &&
          (descriptor.originalName === "*" ||
            descriptor.originalName === "default" ||
            (descriptor.localName === descriptor.originalName &&
              options.includeUnaliasedNamedImports !== true)))
      )
        continue;
      const targetPath =
        resolveDirectRelativeImportPath(
          caller.file,
          descriptor.modulePath,
          availablePaths,
        ) ??
        resolveDirectConfiguredImportPath(
          caller.file,
          descriptor.modulePath,
          availablePaths,
          configuredPathAliases,
        );
      if (
        !targetPath ||
        path.posix.isAbsolute(targetPath) ||
        targetPath.startsWith("../") ||
        (factsByPath.get(targetPath)?.length ?? 0) !== 1
      )
        continue;
      if (isDiscoverableSourceFile(targetPath)) targets.add(targetPath);
    }
  }
  return [...targets].sort();
}

/** Resolve one bounded layer of syntax-confirmed re-export dependencies. */
interface ParsedReexportSource {
  readonly file: string;
  readonly data: {
    readonly imports?: readonly AstImportDescriptor[];
    readonly reexports?: readonly AstReexportDescriptor[];
  };
}

export function reexportTargetPaths(
  parsedFiles: readonly ParsedReexportSource[],
  factRows: readonly Phase2FactFile[],
  configuredPathAliases?: CallResolutionConfiguredPathAliases,
  options: { readonly includeTypeOnlyReexports?: boolean } = {},
): string[] {
  const factsByPath = new Map<string, Phase2FactFile[]>();
  for (const row of factRows) {
    const matches = factsByPath.get(row.filePath) ?? [];
    matches.push(row);
    factsByPath.set(row.filePath, matches);
  }
  const availablePaths = factRows.map(({ filePath }) => filePath);
  const targets = new Set<string>();
  for (const parsed of parsedFiles) {
    const modulePaths = new Set<string>();
    for (const descriptor of parsed.data.reexports ?? []) {
      if (
        (descriptor.isTypeOnly && options.includeTypeOnlyReexports !== true) ||
        descriptor.kind === "namespace"
      )
        continue;
      if (descriptor.kind === "named" || descriptor.kind === "star") {
        modulePaths.add(descriptor.modulePath);
        continue;
      }
      const bindings = (parsed.data.imports ?? []).filter(
        (binding) => binding.localName === descriptor.localName,
      );
      if (
        bindings.length === 1 &&
        !bindings[0]?.viaReexport &&
        (!bindings[0]?.isTypeOnly ||
          options.includeTypeOnlyReexports === true) &&
        bindings[0]?.originalName !== "*"
      )
        modulePaths.add(bindings[0].modulePath);
    }
    for (const modulePath of modulePaths) {
      const targetPath =
        resolveDirectRelativeImportPath(
          parsed.file,
          modulePath,
          availablePaths,
        ) ??
        resolveDirectConfiguredImportPath(
          parsed.file,
          modulePath,
          availablePaths,
          configuredPathAliases,
        );
      if (
        targetPath &&
        (factsByPath.get(targetPath)?.length ?? 0) === 1 &&
        isDiscoverableSourceFile(targetPath)
      )
        targets.add(targetPath);
    }
  }
  return [...targets].sort();
}

/** Expand each parsed source on the frontier once, including already-parsed call sources. */
export function reexportTargetsForFrontier(
  frontierPaths: readonly string[],
  parsedByPath: ReadonlyMap<string, ParsedReexportSource>,
  expandedPaths: Set<string>,
  factRows: readonly Phase2FactFile[],
  configuredPathAliases?: CallResolutionConfiguredPathAliases,
  options: { readonly includeTypeOnlyReexports?: boolean } = {},
): string[] {
  const parsedSources = frontierPaths.flatMap((filePath) => {
    if (expandedPaths.has(filePath)) return [];
    const parsed = parsedByPath.get(filePath);
    if (!parsed) return [];
    expandedPaths.add(filePath);
    return [parsed];
  });
  return reexportTargetPaths(
    parsedSources,
    factRows,
    configuredPathAliases,
    options,
  );
}

/** Parse exact root configuration bytes once; inheritance and unsupported shapes stay unavailable. */
export function configuredPathAliasesFromSource(
  code: string,
  sourceContentHash: string,
): CallResolutionConfiguredPathAliases | undefined {
  if (sha256(Buffer.from(code)) !== sourceContentHash) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const root = parsed as Record<string, unknown>;
  const options = root.compilerOptions;
  if (!options || typeof options !== "object" || Array.isArray(options))
    return undefined;
  const compilerOptions = options as Record<string, unknown>;
  const paths = compilerOptions.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths))
    return undefined;
  const entries = Object.entries(paths);
  if (
    entries.some(
      ([, targets]) =>
        !Array.isArray(targets) ||
        targets.some((target) => typeof target !== "string"),
    )
  )
    return undefined;
  if (
    compilerOptions.baseUrl !== undefined &&
    typeof compilerOptions.baseUrl !== "string"
  )
    return undefined;
  const inherited = root.extends;
  if (
    inherited !== undefined &&
    typeof inherited !== "string" &&
    (!Array.isArray(inherited) ||
      inherited.some((item) => typeof item !== "string"))
  )
    return undefined;
  return {
    configurationFilePath: "tsconfig.json",
    sourceContentHash,
    paths: Object.fromEntries(entries) as Record<string, string[]>,
    baseUrl: (compilerOptions.baseUrl as string | undefined) ?? null,
    extends:
      inherited === undefined
        ? []
        : typeof inherited === "string"
          ? [inherited]
          : (inherited as string[]),
  };
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
  readonly service: CandidateStageTraceService;
  readonly processor: AstProcessingService;
  readonly factsSidecarHash: string;
  readonly includeCandidateStageEvidence?: boolean;
  readonly includeProposalFilterStageEvidence?: boolean;
  /** Add source-bound configuration facts without changing the replay eligibility or runtime policy. */
  readonly includeConfiguredPathAliases?: boolean;
  /** Discover one exact workspace-local target for a combined default import when requested. */
  readonly includeCombinedDefaultImportTargets?: boolean;
  /** Parse direct named-import targets, including unaliased imports, for Q1 audits. */
  readonly includeStrictNamedImportTargets?: boolean;
  /** Parse Q3 receiver-type imports and attach proof-only facts from exact parsed source bytes. */
  readonly includeQ3ReceiverFacts?: boolean;
}): Promise<Phase2SnapshotSourceResult> {
  const { snapshot } = input;
  if (
    (input.includeCandidateStageEvidence ||
      input.includeProposalFilterStageEvidence) &&
    input.sourceRows.some((row) => row.split !== "train")
  )
    throw new Error("Candidate-stage source replay accepts TRAIN rows only.");
  if (
    input.includeProposalFilterStageEvidence &&
    !input.includeCandidateStageEvidence
  )
    throw new Error(
      "Proposal-filter replay requires the base candidate-stage evidence.",
    );
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
    const configurationSource = input.includeConfiguredPathAliases
      ? sourceBytesForPath(input.temporaryDirectory, "tsconfig.json")
      : null;
    const configuredPathAliases = configurationSource
      ? configuredPathAliasesFromSource(
          configurationSource.code,
          configurationSource.hash,
        )
      : undefined;
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
    const importTargetPaths = directImportTargetPaths(
      parsedCallFiles.parsed,
      factRows,
      configuredPathAliases,
      {
        includeCombinedDefaultImports:
          input.includeCombinedDefaultImportTargets ?? false,
        includeUnaliasedNamedImports:
          input.includeStrictNamedImportTargets ?? false,
        includeTypeOnlyImports: input.includeQ3ReceiverFacts ?? false,
      },
    );
    const aliasTargetPaths = importTargetPaths.filter(
      (filePath) => !callSourcePaths.has(filePath),
    );
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
    const parsedReexportTargets: ParsedAstFileResult[] = [];
    const discoveredReexportTargets: Array<{
      file: string;
      hash: string;
      code: string;
    }> = [];
    const reexportTargetFailures = [] as typeof parsedAliasTargets.failures;
    const parsedByPath = new Map(
      [...parsedCallFiles.parsed, ...parsedAliasTargets.parsed].map((row) => [
        row.file,
        row,
      ]),
    );
    const attemptedTargetPaths = new Set([
      ...callSourcePaths,
      ...parsedAliasTargets.parsed.map(({ file }) => file),
    ]);
    const expandedReexportPaths = new Set<string>();
    if (input.includeStrictNamedImportTargets) {
      let frontier = reexportTargetPaths(
        [
          ...parsedAliasTargets.parsed,
          ...parsedCallFiles.parsed.filter(({ file }) =>
            importTargetPaths.includes(file),
          ),
        ],
        factRows,
        configuredPathAliases,
        { includeTypeOnlyReexports: input.includeQ3ReceiverFacts ?? false },
      );
      if (input.includeQ3ReceiverFacts) {
        frontier = [
          ...new Set([
            ...frontier,
            ...directImportTargetPaths(
              [...parsedCallFiles.parsed, ...parsedAliasTargets.parsed],
              factRows,
              configuredPathAliases,
              {
                includeUnaliasedNamedImports: true,
                includeTypeOnlyImports: true,
              },
            ),
          ]),
        ];
      }
      while (frontier.length > 0) {
        const nextPaths = frontier.filter((filePath) => {
          if (parsedByPath.has(filePath) || attemptedTargetPaths.has(filePath))
            return false;
          attemptedTargetPaths.add(filePath);
          return true;
        });
        const discoveredBatch = nextPaths.flatMap((filePath) => {
          const [expected] = factRowsByPath.get(filePath) ?? [];
          if (!expected || (factRowsByPath.get(filePath)?.length ?? 0) !== 1)
            return [];
          const source = sourceBytesForPath(input.temporaryDirectory, filePath);
          if (!source) return [];
          if (source.hash !== expected.fileContentSha256)
            throw new Error(`Re-export source hash differs for ${filePath}.`);
          return [source];
        });
        let parsedFrontier: ParsedAstFileResult[] = [];
        if (discoveredBatch.length > 0) {
          discoveredReexportTargets.push(...discoveredBatch);
          const parsedBatch = await input.processor.processFiles(
            input.temporaryDirectory,
            discoveredBatch,
          );
          parsedFrontier = parsedBatch.parsed;
          parsedReexportTargets.push(...parsedBatch.parsed);
          for (const parsed of parsedBatch.parsed)
            parsedByPath.set(parsed.file, parsed);
          reexportTargetFailures.push(...parsedBatch.failures);
        }
        const nextReexports = reexportTargetsForFrontier(
          frontier,
          parsedByPath,
          expandedReexportPaths,
          factRows,
          configuredPathAliases,
          { includeTypeOnlyReexports: input.includeQ3ReceiverFacts ?? false },
        );
        const nextImports = input.includeQ3ReceiverFacts
          ? directImportTargetPaths(
              parsedFrontier,
              factRows,
              configuredPathAliases,
              {
                includeUnaliasedNamedImports: true,
                includeTypeOnlyImports: true,
              },
            )
          : [];
        frontier = [...new Set([...nextReexports, ...nextImports])];
      }
    }
    const alreadyParsedPaths = new Set(
      [
        ...parsedCallFiles.parsed,
        ...parsedAliasTargets.parsed,
        ...parsedReexportTargets,
      ].map(({ file }) => file),
    );
    const discoveredExportSources = factRows.flatMap((row) => {
      if (alreadyParsedPaths.has(row.filePath)) return [];
      const source = sourceBytesForPath(input.temporaryDirectory, row.filePath);
      if (!source) return [];
      if (source.hash !== row.fileContentSha256)
        throw new Error(`Export source hash differs for ${row.filePath}.`);
      return [source];
    });
    const parsedExportSources = discoveredExportSources.length
      ? await input.processor.processFiles(
          input.temporaryDirectory,
          discoveredExportSources,
        )
      : { parsed: [], failures: [] };
    const parseWallMs = performance.now() - parseStarted;
    const parsedByFile = new Map<string, ParsedAstFileResult>(
      [
        ...parsedCallFiles.parsed,
        ...parsedAliasTargets.parsed,
        ...parsedReexportTargets,
        ...parsedExportSources.parsed,
      ].map((row) => [row.file, row]),
    );
    const sourceHashesByFile = new Map(
      [
        ...discovered,
        ...discoveredAliasTargets,
        ...discoveredReexportTargets,
        ...discoveredExportSources,
      ].map(({ file, hash }) => [file, hash]),
    );
    const factsByFile = new Map(
      factRows.map((row) => [row.filePath, row.declaredTypeFacts]),
    );
    const aliasesByKey = candidateAliasIndex(factRows, parsedByFile);
    const aliasesByName = aliasCollisionCounts(aliasesByKey);
    const sourceFingerprint = canonicalHash({
      snapshotHash: snapshot.snapshotHash,
      factsSidecarHash: input.factsSidecarHash,
      factFiles: factRows.map(({ filePath, fileContentSha256 }) => ({
        filePath,
        fileContentSha256,
      })),
      parsedInputs: [
        ...discovered,
        ...discoveredAliasTargets,
        ...discoveredReexportTargets,
        ...discoveredExportSources,
      ].map(({ file, hash }) => ({ file, hash })),
    });
    const workspaceIndex = input.service.indexWorkspace({
      sourceFingerprint,
      sourceIndexComplete: true,
      sourceFiles: workspaceSourceFiles(
        factRows,
        parsedByFile,
        !input.includeCombinedDefaultImportTargets,
        input.includeQ3ReceiverFacts ?? false,
      ),
      ...(configuredPathAliases === undefined ? {} : { configuredPathAliases }),
    });
    const callShapeMaps = new Map(
      [...parsedByFile].map(([file, row]) => [
        file,
        callShapesByPosition(row.data.callSiteShapeFacts?.callSites ?? []),
      ]),
    );
    const observations: Phase2EvaluationObservation[] = [];
    const candidateStageEvidence: CandidateStageEvidence[] = [];
    const proposalFilterStageEvidence: ProposalFilterStageEvidence[] = [];
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
      const sourceContentHash = sourceHashesByFile.get(source.filePath);
      const captureCandidateStageEvidence =
        input.includeCandidateStageEvidence ||
        input.includeProposalFilterStageEvidence;
      if (captureCandidateStageEvidence && !sourceContentHash)
        throw new Error(
          `TRAIN caller source bytes were not pinned for ${source.filePath}.`,
        );
      const candidateStageContext =
        captureCandidateStageEvidence && sourceContentHash
          ? {
              sourceContentHash,
              captureProposalFilterStages:
                input.includeProposalFilterStageEvidence ?? false,
              callSiteInputHash: candidateStageCallSiteInputHash(
                source,
                sourceContentHash,
                callSite ?? null,
              ),
            }
          : undefined;
      if (!callSite || source.positionStatus !== "unique") {
        observations.push(observationWithoutCall(source));
        if (candidateStageContext && input.includeCandidateStageEvidence) {
          candidateStageEvidence.push(
            createCandidateStageEvidence(
              {
                sampleId: source.sampleId,
                split: source.split,
                sourceContentHash: candidateStageContext.sourceContentHash,
                callSiteInputHash: candidateStageContext.callSiteInputHash,
                generatedCandidateKeys: [],
                orderedProposalKeys: [],
              },
              (key) =>
                candidateTargetMappingForKey(key, aliasesByKey, aliasesByName),
            ),
          );
        }
        if (candidateStageContext && input.includeProposalFilterStageEvidence) {
          const emptyKeys: CallResolutionCandidateStageTrace = {
            beforeVisibility: [],
            afterVisibility: [],
            afterExplicitReceiverType: [],
            afterPeerMembers: [],
            afterArgumentShape: [],
            beforeMaxCandidates: [],
            afterMaxCandidates: [],
          };
          proposalFilterStageEvidence.push(
            createProposalFilterStageEvidence(
              {
                sampleId: source.sampleId,
                split: source.split,
                sourceContentHash: candidateStageContext.sourceContentHash,
                callSiteInputHash: candidateStageContext.callSiteInputHash,
                candidateKeysByStage: emptyKeys,
              },
              (key) =>
                candidateTargetMappingForKey(key, aliasesByKey, aliasesByName),
            ),
          );
        }
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
        candidateStageContext,
      );
      hypothesisLatenciesMs.push(performance.now() - started);
      observations.push(result.observation);
      if (result.candidateStageEvidence)
        if (input.includeCandidateStageEvidence)
          candidateStageEvidence.push(result.candidateStageEvidence);
      if (result.proposalFilterStageEvidence)
        proposalFilterStageEvidence.push(result.proposalFilterStageEvidence);
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
      ...(input.includeCandidateStageEvidence
        ? { candidateStageEvidence }
        : {}),
      ...(input.includeProposalFilterStageEvidence
        ? { proposalFilterStageEvidence }
        : {}),
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
      parsedImportTargetFileCount:
        parsedAliasTargets.parsed.length + parsedReexportTargets.length,
      parsedExportSourceFileCount: parsedExportSources.parsed.length,
      parseFailureCount:
        parsedCallFiles.failures.length +
        parsedAliasTargets.failures.length +
        parsedExportSources.failures.length +
        reexportTargetFailures.length,
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
