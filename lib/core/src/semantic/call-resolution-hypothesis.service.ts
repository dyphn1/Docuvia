import type {
  AstDeclaredTypeOwner,
  AstCallSiteShapeFact,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisResult,
  CallResolutionHypothesisServiceOptions,
  CallResolutionHypothesisWorkspaceIndex,
  CallResolutionHypothesisWorkspaceInput,
  ICallResolutionHypothesisService,
} from "@workspace/contracts";
import {
  CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
  DocuviaError,
  ErrorCodes,
} from "@workspace/contracts";
import {
  matchingCalibrationRecords,
  selectValidCalibrationRecord,
} from "./call-resolution-hypothesis-calibration.js";
import {
  CandidateWithoutRank,
  NormalizedServiceOptions,
  createConfigurationHash,
  normalizeServiceOptions,
  validateHypothesisRequest,
} from "./call-resolution-hypothesis-internal.js";
import {
  IndexedWorkspace,
  createIndexedWorkspace,
  createRuleSignature,
  getReceiverTypeFact,
  hashFeatureInput,
  canSearchWorkspaceExportsForImportSpecifier,
  candidateMemberDomainSignaturesByFile,
  isWorkspaceBoundSourcePath,
  resolveDirectConfiguredImportPath,
  resolveDirectRelativeImportPath,
} from "./call-resolution-hypothesis-index.js";
import {
  boundProposals,
  type CandidateFilterStageKeys,
  decideResolution,
  filterCandidates,
  rankCandidates,
} from "./call-resolution-hypothesis-ranking.js";
import {
  proveUniqueNamedImport,
  proveUniqueThisMember,
} from "./call-resolution-strict-proof.js";
import { proveUniqueReexportedNamedImport } from "./call-resolution-reexport-proof.js";

export interface CallResolutionCandidateStageTrace extends CandidateFilterStageKeys {
  readonly beforeMaxCandidates: readonly string[];
  readonly afterMaxCandidates: readonly string[];
}

export interface CallResolutionHypothesisWithCandidateStageTrace {
  readonly result: CallResolutionHypothesisResult;
  readonly candidateStageTrace: CallResolutionCandidateStageTrace;
}

interface HypothesisComputation {
  readonly result: CallResolutionHypothesisResult;
  readonly candidateStageTrace?: CallResolutionCandidateStageTrace;
}

function sameCalleeBinding(
  left: AstCallSiteShapeFact["calleeBinding"],
  right: AstCallSiteShapeFact["calleeBinding"],
): boolean {
  if (!left || !right) return left === right;
  if (left.kind !== right.kind || left.name !== right.name) return false;
  if (left.kind === "unbound" || right.kind === "unbound")
    return left.kind === right.kind;
  return (
    left.declarationSpan.start === right.declarationSpan.start &&
    left.declarationSpan.end === right.declarationSpan.end &&
    left.scopeSpan.start === right.scopeSpan.start &&
    left.scopeSpan.end === right.scopeSpan.end
  );
}

function receiverTypeUsesReexportedBinding(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): boolean {
  const descriptor = receiverTypeImportDescriptor(request, workspace);
  return descriptor
    ? hasNamedReexportBinding(request, workspace, descriptor)
    : false;
}

function receiverTypeImportDescriptor(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
) {
  if (request.callSite.calleeKind !== "member") return undefined;
  const receiverFact = getReceiverTypeFact(workspace, request);
  if (!receiverFact) return undefined;
  const caller = workspace.sourceFilesByPath.get(request.callerFilePath);
  if (!caller) return undefined;
  const descriptors = (caller.imports ?? []).filter(
    ({ localName }) => localName === receiverFact.typeName,
  );
  const [descriptor] = descriptors;
  return descriptors.length === 1 && descriptor && !descriptor.isTypeOnly
    ? descriptor
    : undefined;
}

function hasNamedReexportBinding(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  descriptor: NonNullable<
    CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["imports"]
  >[number],
): boolean {
  const availableFilePaths = [...workspace.sourceFilesByPath.keys()];
  const targetPath =
    resolveDirectRelativeImportPath(
      request.callerFilePath,
      descriptor.modulePath,
      availableFilePaths,
    ) ??
    resolveDirectConfiguredImportPath(
      request.callerFilePath,
      descriptor.modulePath,
      availableFilePaths,
      workspace.configuredPathAliases,
    );
  if (!targetPath) return false;
  const target = workspace.sourceFilesByPath.get(targetPath);
  return Boolean(
    target?.reexports?.some(
      (route) =>
        route.kind === "named" &&
        route.exportedName === descriptor.originalName &&
        !route.isTypeOnly,
    ),
  );
}

function strictProofForCandidates(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  generated: CallResolutionHypothesisResult["candidates"],
  truncated: boolean,
) {
  const namedImportProof = proveUniqueNamedImport(
    request,
    workspace,
    truncated,
  );
  if (namedImportProof?.status === "proven") return namedImportProof;
  const reexportProof = proveUniqueReexportedNamedImport(
    request,
    workspace,
    truncated,
  );
  if (reexportProof) return reexportProof;
  if (namedImportProof) return namedImportProof;
  const thisMemberProof = proveUniqueThisMember(
    request,
    generated,
    workspace,
    truncated,
  );
  if (
    thisMemberProof.status === "proven" &&
    thisMemberProof.reason === "unique-typed-receiver-member" &&
    receiverTypeUsesReexportedBinding(request, workspace)
  )
    return {
      status: "abstained" as const,
      targetKey: null,
      ruleSignature: null,
      reason: "unresolved-type-binding" as const,
      consultedCandidateMemberNames:
        thisMemberProof.consultedCandidateMemberNames ?? [],
    };
  return thisMemberProof;
}

function localClassStaticCandidates(
  callerFacts: NonNullable<
    CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["declaredTypeFacts"]
  >,
  callerFilePath: string,
  receiverName: string,
  importDescriptors: readonly NonNullable<
    CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["imports"]
  >[number][],
  baseCandidates: readonly CandidateWithoutRank[],
): readonly CandidateWithoutRank[] | null | undefined {
  const localOwners = callerFacts.ownerInventories.filter(
    ({ owner }) => owner.kind === "class" && owner.name === receiverName,
  );
  if (localOwners.length === 1 && importDescriptors.length === 0)
    return baseCandidates.filter(
      ({ filePath, owner, isStatic }) =>
        filePath === callerFilePath &&
        owner.kind === "class" &&
        owner.name === receiverName &&
        isStatic,
    );
  if (localOwners.length > 0 || importDescriptors.length !== 1)
    return undefined;
  return null;
}

function isSupportedClassImport(
  descriptor:
    | NonNullable<
        CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["imports"]
      >[number]
    | undefined,
  callerFilePath: string,
): descriptor is NonNullable<
  CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["imports"]
>[number] {
  if (!descriptor || descriptor.viaReexport || descriptor.isTypeOnly)
    return false;
  if (
    descriptor.originalName === "default" &&
    descriptor.isDefaultImport !== true &&
    descriptor.isCombinedDefaultImport !== true
  )
    return false;
  const importedName = importedClassName(descriptor);
  return (
    importedName !== null &&
    importedName !== "*" &&
    (importedName !== "default" || isWorkspaceBoundSourcePath(callerFilePath))
  );
}

function importedClassName(
  descriptor: NonNullable<
    CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["imports"]
  >[number],
): string {
  return descriptor.isDefaultImport === true ||
    (descriptor.isCombinedDefaultImport === true &&
      descriptor.originalName === "default")
    ? "default"
    : descriptor.originalName;
}

function isSimpleIdentifier(value: string | null): value is string {
  return value !== null && /^[$A-Z_a-z][$\w]*$/u.test(value);
}

function importedClassTargetPath(
  callerFilePath: string,
  descriptor: NonNullable<
    CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["imports"]
  >[number],
  workspace: IndexedWorkspace,
): string | undefined {
  const availableFilePaths = [...workspace.sourceFilesByPath.keys()];
  return (
    resolveDirectRelativeImportPath(
      callerFilePath,
      descriptor.modulePath,
      availableFilePaths,
    ) ??
    resolveDirectConfiguredImportPath(
      callerFilePath,
      descriptor.modulePath,
      availableFilePaths,
      workspace.configuredPathAliases,
    )
  );
}

function importedClassStaticCandidates(
  callerFilePath: string,
  workspace: IndexedWorkspace,
  descriptor:
    | NonNullable<
        CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]["imports"]
      >[number]
    | undefined,
  baseCandidates: readonly CandidateWithoutRank[],
): readonly CandidateWithoutRank[] | undefined {
  if (!isSupportedClassImport(descriptor, callerFilePath) || !descriptor)
    return undefined;
  const importedName = importedClassName(descriptor);
  const targetPath = importedClassTargetPath(
    callerFilePath,
    descriptor,
    workspace,
  );
  if (
    !targetPath &&
    !canSearchWorkspaceExportsForImportSpecifier(descriptor.modulePath)
  )
    return undefined;
  const classTargets = classTargetsForImportedName(
    workspace,
    importedName,
    targetPath,
  );
  if (classTargets.size === 0) return undefined;
  return baseCandidates.filter(
    ({ filePath, owner, isStatic }) =>
      owner.kind === "class" &&
      owner.name !== null &&
      classTargets.get(filePath)?.has(owner.name) &&
      isStatic,
  );
}

function uniqueExportedClassName(
  source: CallResolutionHypothesisWorkspaceInput["sourceFiles"][number],
  importedName: string,
): string | null {
  const directExports = source.exports?.filter(
    ({ name, type }) => name === importedName && type === "class",
  );
  if (directExports?.length !== 1) return null;
  const classOwners = (source.declaredTypeFacts?.ownerInventories ?? [])
    .map(({ owner }) => owner)
    .filter((owner) => owner.kind === "class");
  const className = importedClassOwnerName(importedName, classOwners);
  if (
    !className ||
    classOwners.filter(({ name }) => name === className).length !== 1
  )
    return null;
  return className;
}

function importedClassOwnerName(
  importedName: string,
  classOwners: readonly AstDeclaredTypeOwner[],
): string | undefined {
  if (importedName !== "default") return importedName;
  const [owner] = classOwners;
  return classOwners.length === 1 && owner?.kind === "class"
    ? (owner.name ?? undefined)
    : undefined;
}

export class CallResolutionHypothesisService implements ICallResolutionHypothesisService {
  private readonly options: NormalizedServiceOptions;
  private readonly configurationHash: string;
  private readonly indexes = new WeakMap<object, IndexedWorkspace>();

  constructor(options: CallResolutionHypothesisServiceOptions = {}) {
    this.options = normalizeServiceOptions(options);
    this.configurationHash = createConfigurationHash(this.options);
  }

  candidateMemberDomainSignaturesByFile(
    sourceFiles: readonly CallResolutionHypothesisWorkspaceInput["sourceFiles"][number][],
  ): Map<string, Map<string, string>> {
    return candidateMemberDomainSignaturesByFile(sourceFiles);
  }

  indexWorkspace(
    input: CallResolutionHypothesisWorkspaceInput,
  ): CallResolutionHypothesisWorkspaceIndex {
    const workspace = createIndexedWorkspace(input, this.configurationHash);
    this.indexes.set(workspace.handle, workspace);
    return workspace.handle;
  }

  hypothesize(
    request: CallResolutionHypothesisRequest,
  ): CallResolutionHypothesisResult {
    return this.computeHypothesis(request, false).result;
  }

  /**
   * Returns exact ranked target keys after each filter and on both sides of
   * the display cap. This measurement-only path must not affect the result.
   */
  hypothesizeWithCandidateStageTrace(
    request: CallResolutionHypothesisRequest,
  ): CallResolutionHypothesisWithCandidateStageTrace {
    const computation = this.computeHypothesis(request, true);
    if (!computation.candidateStageTrace)
      throw new Error("Candidate stage trace was not captured.");
    return {
      result: computation.result,
      candidateStageTrace: computation.candidateStageTrace,
    };
  }

  private computeHypothesis(
    request: CallResolutionHypothesisRequest,
    captureCandidateStageTrace: boolean,
  ): HypothesisComputation {
    validateHypothesisRequest(request);
    const workspace = this.getWorkspace(request.workspaceIndex);
    const baseIndexedCandidates =
      workspace.candidatesByMember.get(request.callSite.calleeName) ?? [];
    const indexedCandidates = this.candidatesForRequest(
      request,
      workspace,
      baseIndexedCandidates,
    );
    const receiverFact = getReceiverTypeFact(workspace, request);
    const receiverTypeName = receiverFact?.typeName ?? null;
    const generated = rankCandidates(
      indexedCandidates,
      request,
      workspace,
      receiverTypeName,
    );
    const ruleSignature = createRuleSignature(
      request,
      workspace,
      indexedCandidates,
      receiverFact,
      this.configurationHash,
    );
    const featureInputHash = hashFeatureInput(
      request,
      workspace,
      generated,
      receiverFact,
    );
    const filtered = filterCandidates(
      generated,
      request,
      workspace,
      receiverTypeName,
      captureCandidateStageTrace,
    );
    const { proposals, truncated } = boundProposals(
      filtered.candidates,
      this.options,
    );
    const strictProof = strictProofForCandidates(
      request,
      workspace,
      generated,
      truncated,
    );
    const matchingRecords = matchingCalibrationRecords(
      this.options.calibrationRecords,
      ruleSignature,
    );
    const calibration = selectValidCalibrationRecord(
      matchingRecords,
      this.options,
      ruleSignature,
      this.configurationHash,
    );
    const decision = decideResolution(
      proposals,
      truncated,
      filtered.unsupportedCallShape,
      matchingRecords.length > 0,
      calibration,
    );
    this.verifyDecisionConfidence(decision.confidence);

    const result: CallResolutionHypothesisResult = {
      schemaVersion: CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
      candidateGeneratorVersion: workspace.handle.candidateGeneratorVersion,
      configurationHash: this.configurationHash,
      sourceFingerprint: workspace.handle.sourceFingerprint,
      featureInputHash,
      ruleSignature,
      candidateSetComplete:
        workspace.complete &&
        indexedCandidates.every(({ declarations }) => declarations.length > 0),
      truncated,
      generatedCandidateKeys: indexedCandidates.map(
        ({ targetKey }) => targetKey,
      ),
      candidates: proposals,
      filterStages: filtered.stages,
      status: decision.status,
      selected: decision.selected,
      confidence: decision.confidence,
      reason: decision.reason,
      strictProof,
    };
    if (!captureCandidateStageTrace) return { result };
    const stageKeys = filtered.candidateStageKeys;
    if (!stageKeys)
      throw new Error("Candidate filter stage keys were not captured.");
    return {
      result,
      candidateStageTrace: {
        ...stageKeys,
        beforeMaxCandidates: filtered.candidates.map(
          ({ targetKey }) => targetKey,
        ),
        afterMaxCandidates: proposals.map(({ targetKey }) => targetKey),
      },
    };
  }

  private getWorkspace(
    handle: CallResolutionHypothesisWorkspaceIndex,
  ): IndexedWorkspace {
    const workspace = this.indexes.get(handle);
    if (!workspace)
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "workspaceIndex must come from this service instance.",
      );
    return workspace;
  }

  private candidatesForRequest(
    request: CallResolutionHypothesisRequest,
    workspace: IndexedWorkspace,
    baseCandidates: readonly CandidateWithoutRank[],
  ): readonly CandidateWithoutRank[] {
    const classQualifiedCandidates = this.candidatesForSyntaxBoundClass(
      request,
      workspace,
      baseCandidates,
    );
    if (classQualifiedCandidates !== undefined) return classQualifiedCandidates;
    if (!this.canEnrichImportAlias(request, workspace)) return baseCandidates;
    const aliases =
      workspace.directImportAliasCandidatesByCallerFile
        .get(request.callerFilePath)
        ?.get(request.callSite.calleeName) ?? [];
    return mergeCandidatesByTargetKey(baseCandidates, aliases);
  }

  /**
   * A simple class identifier in `ClassName.member()` is direct syntax evidence.
   * Resolve only a unique declaration or direct import; all other receivers keep
   * the ordinary candidate set for LSP to decide.
   */
  private candidatesForSyntaxBoundClass(
    request: CallResolutionHypothesisRequest,
    workspace: IndexedWorkspace,
    baseCandidates: readonly CandidateWithoutRank[],
  ): readonly CandidateWithoutRank[] | undefined {
    const callSite = request.callSite;
    const receiverName = callSite.receiverText;
    if (!receiverName || !this.isSourceBoundClassReceiver(request, workspace))
      return undefined;

    const caller = workspace.sourceFilesByPath.get(request.callerFilePath);
    const callerFacts = caller?.declaredTypeFacts;
    if (!caller || !callerFacts) return undefined;

    const importDescriptors = (caller.imports ?? []).filter(
      ({ localName }) => localName === receiverName,
    );
    const localCandidates = localClassStaticCandidates(
      callerFacts,
      request.callerFilePath,
      receiverName,
      importDescriptors,
      baseCandidates,
    );
    if (localCandidates !== null) return localCandidates;
    return importedClassStaticCandidates(
      request.callerFilePath,
      workspace,
      importDescriptors[0],
      baseCandidates,
    );
  }

  private isSourceBoundClassReceiver(
    request: CallResolutionHypothesisRequest,
    workspace: IndexedWorkspace,
  ): boolean {
    const callSite = request.callSite;
    return (
      callSite.calleeKind === "member" &&
      callSite.receiverBinding === null &&
      isSimpleIdentifier(callSite.receiverText) &&
      this.isCallSiteBoundToCaller(
        callSite,
        workspace,
        request.callerFilePath,
      ) &&
      !!request.callerSourceContentHash &&
      workspace.sourceContentHashByFile.get(request.callerFilePath) ===
        request.callerSourceContentHash
    );
  }

  private canEnrichImportAlias(
    request: CallResolutionHypothesisRequest,
    workspace: IndexedWorkspace,
  ): boolean {
    return (
      request.callSite.calleeBinding?.kind !== "type-only-import" &&
      request.callSite.calleeKind === "bare" &&
      request.callSite.calleeBinding?.kind === "import" &&
      !!request.callerSourceContentHash &&
      workspace.sourceContentHashByFile.get(request.callerFilePath) ===
        request.callerSourceContentHash &&
      this.isCallSiteBoundToCaller(
        request.callSite,
        workspace,
        request.callerFilePath,
      )
    );
  }

  private isCallSiteBoundToCaller(
    callSite: AstCallSiteShapeFact,
    workspace: IndexedWorkspace,
    callerFilePath: string,
  ): boolean {
    const matches = (
      workspace.callSiteShapesByFile.get(callerFilePath) ?? []
    ).filter(
      (shape) =>
        shape.startLine === callSite.startLine &&
        shape.startColumn === callSite.startColumn &&
        shape.calleeName === callSite.calleeName &&
        shape.calleeKind === callSite.calleeKind &&
        shape.receiverText === callSite.receiverText &&
        sameCalleeBinding(shape.calleeBinding, callSite.calleeBinding),
    );
    return matches.length === 1;
  }

  private verifyDecisionConfidence(confidence: number | null): void {
    if (
      confidence !== null &&
      (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    )
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "calibrated confidence must be finite and in [0, 1].",
      );
  }
}

function mergeCandidatesByTargetKey(
  baseCandidates: readonly CandidateWithoutRank[],
  aliases: readonly CandidateWithoutRank[],
): readonly CandidateWithoutRank[] {
  if (aliases.length === 0) return baseCandidates;
  const combined = new Map(
    baseCandidates.map((candidate) => [candidate.targetKey, candidate]),
  );
  for (const candidate of aliases) combined.set(candidate.targetKey, candidate);
  return [...combined.values()];
}

function classTargetsForImportedName(
  workspace: IndexedWorkspace,
  importedName: string,
  preferredPath: string | undefined,
): ReadonlyMap<string, ReadonlySet<string>> {
  const paths = preferredPath
    ? [preferredPath]
    : [...workspace.sourceFilesByPath.keys()].sort((left, right) =>
        left.localeCompare(right),
      );
  const targets = new Map<string, Set<string>>();
  for (const filePath of paths) {
    const source = workspace.sourceFilesByPath.get(filePath);
    if (!source) continue;
    const className = uniqueExportedClassName(source, importedName);
    if (!className) continue;
    const names = targets.get(filePath) ?? new Set<string>();
    names.add(className);
    targets.set(filePath, names);
  }
  if (targets.size === 0 && preferredPath)
    return classTargetsForImportedName(workspace, importedName, undefined);
  return targets;
}
