import { createHash } from "node:crypto";
import type {
  AstDeclaredDeclaration,
  AstDeclaredTypeFact,
  AstDeclaredTypeFacts,
  AstDeclaredTypeOwner,
  CallResolutionCalibrationRecord,
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisFilterStage,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisResult,
  CallResolutionHypothesisServiceOptions,
  CallResolutionHypothesisWorkspaceIndex,
  CallResolutionHypothesisWorkspaceInput,
  ICallResolutionHypothesisService,
} from "@workspace/contracts";
import {
  AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
  AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
  CALL_RESOLUTION_RANKING_POLICY_VERSION,
  DocuviaError,
  ErrorCodes,
} from "@workspace/contracts";
import { clopperPearsonLowerBound } from "./system1/eval/system1-eval-calibration.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FLOAT_EPSILON = 1e-10;
const DEFAULTS = {
  maxCandidates: 25,
  minimumIndependentGroups: 100,
  minimumConfidenceLowerBound: 0.9,
  targetFamilyMacroTop1: 0.9,
} as const;
const RANKING_WEIGHTS = {
  explicitReceiverType: 100,
  peerMembers: 20,
  compatibleArity: 10,
  sameDirectory: 1,
} as const;

type CandidateWithoutRank = Omit<
  CallResolutionHypothesisCandidate,
  "rankScore" | "rankingSignals"
>;

interface MutableCandidate {
  filePath: string;
  owner: AstDeclaredTypeOwner;
  memberName: string;
  isStatic: boolean;
  declarations: AstDeclaredDeclaration[];
  sourceLanguage: AstDeclaredTypeFacts["language"];
  inventoryComplete: boolean;
  targetKey: string;
}

interface IndexedWorkspace {
  readonly handle: CallResolutionHypothesisWorkspaceIndex;
  readonly complete: boolean;
  readonly candidatesByMember: ReadonlyMap<
    string,
    readonly CandidateWithoutRank[]
  >;
  readonly memberNamesByTargetKey: ReadonlyMap<string, ReadonlySet<string>>;
  readonly factsByFile: ReadonlyMap<string, readonly AstDeclaredTypeFact[]>;
  readonly duplicateSourcePaths: boolean;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(objectValue)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function ownerKey(owner: AstDeclaredTypeOwner): string {
  return `${owner.kind}:${owner.span.start}:${owner.span.end}:${owner.name ?? ""}`;
}

function ownerMembersKey(
  filePath: string,
  owner: AstDeclaredTypeOwner,
  isStatic: boolean,
): string {
  return `${filePath}#${ownerKey(owner)}#${Number(isStatic)}`;
}

function targetKey(
  filePath: string,
  owner: AstDeclaredTypeOwner,
  memberName: string,
  isStatic: boolean,
  individualDeclarationSpan?: { start: number; end: number },
): string {
  if (individualDeclarationSpan)
    return `${filePath}#function:${individualDeclarationSpan.start}:${individualDeclarationSpan.end}#${memberName}`;
  return `${filePath}#${ownerKey(owner)}#${memberName}#${Number(isStatic)}`;
}

function stage(
  inputCount: number,
  outputCount: number,
  applied: boolean,
): CallResolutionHypothesisFilterStage {
  return { inputCount, outputCount, applied };
}

function isFiniteRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= FLOAT_EPSILON;
}

function receiverTypeFact(
  workspace: IndexedWorkspace,
  request: CallResolutionHypothesisRequest,
): AstDeclaredTypeFact | undefined {
  const binding = request.callSite.receiverBinding;
  if (!binding) return undefined;
  return workspace.factsByFile
    .get(request.callerFilePath)
    ?.find(
      (fact) =>
        fact.declarationSpan.start === binding.declarationSpan.start &&
        fact.declarationSpan.end === binding.declarationSpan.end &&
        [
          "field-annotation",
          "parameter-annotation",
          "parameter-property",
          "variable-annotation",
          "new-initializer",
        ].includes(fact.kind),
    );
}

function relationMatchesReceiver(
  candidate: CandidateWithoutRank,
  factsForCandidateFile: readonly AstDeclaredTypeFact[],
  receiverTypeName: string,
): boolean {
  if (candidate.owner.name === receiverTypeName) return true;
  return factsForCandidateFile.some(
    (fact) =>
      fact.owner.name === candidate.owner.name &&
      fact.owner.kind === candidate.owner.kind &&
      fact.owner.span.start === candidate.owner.span.start &&
      fact.owner.span.end === candidate.owner.span.end &&
      (fact.kind === "extends" || fact.kind === "implements") &&
      fact.typeName === receiverTypeName,
  );
}

function compatibleArity(
  declaration: AstDeclaredDeclaration,
  count: number,
): boolean | undefined {
  if (!declaration.arity || declaration.unsupportedReason) return undefined;
  return (
    count >= declaration.arity.requiredParameterCount &&
    (declaration.arity.maxParameterCount === null ||
      count <= declaration.arity.maxParameterCount)
  );
}

function ownerInventoryComplete(
  facts: AstDeclaredTypeFacts,
  owner: AstDeclaredTypeOwner,
): boolean {
  return (
    facts.ownerInventories.find(
      (inventory) => ownerKey(inventory.owner) === ownerKey(owner),
    )?.complete ?? false
  );
}

function configurationPolicy(): object {
  return {
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    rankingPolicyVersion: CALL_RESOLUTION_RANKING_POLICY_VERSION,
    declaredTypeFactsSchemaVersion: AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
    callSiteShapeSchemaVersion: AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
    filterOrder: ["visibility", "explicit-receiver", "peer-members", "arity"],
    rankingWeights: RANKING_WEIGHTS,
    arityPolicy: {
      javascript: "ranking-only",
      unknownOrSpread: "retain",
      typescript: "filter-only-on-complete-known-signature",
    },
    visibilityPolicy: "private-only-when-caller-owner-is-exact",
  };
}

function argumentCountBucket(count: number | null): string {
  if (count === null) return "unknown";
  if (count <= 2) return String(count);
  return "3plus";
}

function peerCountBucket(count: number): string {
  if (count === 0) return "none";
  if (count === 1) return "one";
  return "multiple";
}

function candidateCountBucket(count: number): string {
  if (count <= 1) return String(count);
  if (count === 2) return "2";
  return "3plus";
}

function rulePattern(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  candidates: readonly CandidateWithoutRank[],
  receiverFact: AstDeclaredTypeFact | undefined,
): object {
  return {
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    rankingPolicyVersion: CALL_RESOLUTION_RANKING_POLICY_VERSION,
    calleeKind: request.callSite.calleeKind,
    receiverBindingKind: request.callSite.receiverBinding?.kind ?? "none",
    receiverFactKind: receiverFact?.kind ?? "none",
    hasCallerType: request.callSite.callerType !== null,
    hasPeerEvidence: request.callSite.peerMemberNames.length > 0,
    peerCount: peerCountBucket(request.callSite.peerMemberNames.length),
    argumentCount: argumentCountBucket(request.callSite.argumentCount),
    hasSpreadArgument: request.callSite.hasSpreadArgument,
    argumentKinds: request.callSite.argumentKinds,
    candidateCount: candidateCountBucket(candidates.length),
    candidateOwnerKinds: [
      ...new Set(candidates.map(({ owner }) => owner.kind)),
    ].sort(),
    candidateLanguages: [
      ...new Set(candidates.map(({ sourceLanguage }) => sourceLanguage)),
    ].sort(),
    candidateDispatchKinds: [
      ...new Set(
        candidates.map(
          ({ owner, sourceLanguage, isStatic }) =>
            `${owner.kind}:${sourceLanguage}:${isStatic ? "static" : "instance"}`,
        ),
      ),
    ].sort(),
    candidateSetComplete: workspace.complete,
  };
}

function featureInput(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  candidates: readonly CallResolutionHypothesisCandidate[],
  receiverFact: AstDeclaredTypeFact | undefined,
): object {
  return {
    sourceFingerprint: workspace.handle.sourceFingerprint,
    callerFilePath: request.callerFilePath,
    callSite: request.callSite,
    receiverTypeFact: receiverFact ?? null,
    candidateSetComplete: workspace.complete,
    duplicateSourcePaths: workspace.duplicateSourcePaths,
    candidates: candidates.map((candidate) => ({
      targetKey: candidate.targetKey,
      filePath: candidate.filePath,
      owner: candidate.owner,
      memberName: candidate.memberName,
      isStatic: candidate.isStatic,
      inventoryComplete: candidate.inventoryComplete,
      declarations: candidate.declarations.map((declaration) => ({
        kind: declaration.kind,
        name: declaration.name,
        declarationSpan: declaration.declarationSpan,
        visibility: declaration.visibility,
        isStatic: declaration.isStatic,
        isOptional: declaration.isOptional,
        arity: declaration.arity,
        unsupportedReason: declaration.unsupportedReason ?? null,
      })),
    })),
  };
}

function calibrationRecordHash(
  record: CallResolutionCalibrationRecord,
): string {
  const { calibrationRecordHash: _ignored, ...payload } = record;
  return hash(payload);
}

function calibrationRecordIsValid(
  record: CallResolutionCalibrationRecord,
  options: Required<
    Pick<
      CallResolutionHypothesisServiceOptions,
      | "minimumIndependentGroups"
      | "minimumConfidenceLowerBound"
      | "targetFamilyMacroTop1"
    >
  >,
  ruleSignature: string,
  configurationHash: string,
): boolean {
  if (
    record.schemaVersion !== CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION ||
    record.split !== "calibration" ||
    record.ruleSignature !== ruleSignature ||
    record.candidateGeneratorVersion !==
      CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION ||
    record.configurationHash !== configurationHash ||
    !HASH_PATTERN.test(record.calibrationInputFingerprint) ||
    !HASH_PATTERN.test(record.calibrationRecordHash) ||
    !Number.isInteger(record.independentGroupCount) ||
    record.independentGroupCount < options.minimumIndependentGroups ||
    !Number.isInteger(record.correctGroupCount) ||
    record.correctGroupCount < 0 ||
    record.correctGroupCount > record.independentGroupCount ||
    !Number.isFinite(record.thresholdScore) ||
    !Number.isInteger(record.minimumIndependentGroups) ||
    record.minimumIndependentGroups !== options.minimumIndependentGroups ||
    !closeEnough(
      record.minimumConfidenceLowerBound,
      options.minimumConfidenceLowerBound,
    ) ||
    !closeEnough(record.targetFamilyMacroTop1, options.targetFamilyMacroTop1) ||
    !isFiniteRatio(record.confidenceLowerBound) ||
    !Array.isArray(record.familyMetrics) ||
    record.familyMetrics.length === 0 ||
    record.familyMetrics.some(
      (metric) =>
        !metric ||
        typeof metric.family !== "string" ||
        metric.family.trim().length === 0 ||
        !Number.isInteger(metric.eligibleSiteCount) ||
        metric.eligibleSiteCount <= 0 ||
        !isFiniteRatio(metric.top1Accuracy),
    ) ||
    new Set(record.familyMetrics.map(({ family }) => family)).size !==
      record.familyMetrics.length
  ) {
    return false;
  }
  const lowerBound = clopperPearsonLowerBound(
    record.correctGroupCount,
    record.independentGroupCount,
  );
  const familyMacro =
    record.familyMetrics.reduce((sum, metric) => sum + metric.top1Accuracy, 0) /
    record.familyMetrics.length;
  return (
    closeEnough(record.confidenceLowerBound, lowerBound) &&
    lowerBound >= options.minimumConfidenceLowerBound &&
    familyMacro >= options.targetFamilyMacroTop1 &&
    calibrationRecordHash(record) === record.calibrationRecordHash
  );
}

function validateWorkspaceInput(
  input: CallResolutionHypothesisWorkspaceInput,
): void {
  if (!HASH_PATTERN.test(input.sourceFingerprint))
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "sourceFingerprint must be a lowercase SHA-256 hash.",
    );
  if (!Array.isArray(input.sourceFiles))
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "sourceFiles must be an array.",
    );
  if (typeof input.sourceIndexComplete !== "boolean")
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "sourceIndexComplete must be a boolean.",
    );
  if (input.sourceFiles.some(({ filePath }) => !filePath))
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "Every source file must have a filePath.",
    );
}

function validateRequest(request: CallResolutionHypothesisRequest): void {
  if (!request.callerFilePath || !request.callSite?.calleeName)
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "callerFilePath and callSite.calleeName are required.",
    );
  if (
    request.callSite.argumentCount !== null &&
    (!Number.isInteger(request.callSite.argumentCount) ||
      request.callSite.argumentCount < 0)
  ) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "argumentCount must be a non-negative integer or null.",
    );
  }
}

export class CallResolutionHypothesisService implements ICallResolutionHypothesisService {
  private readonly options: Required<
    Pick<
      CallResolutionHypothesisServiceOptions,
      | "maxCandidates"
      | "minimumIndependentGroups"
      | "minimumConfidenceLowerBound"
      | "targetFamilyMacroTop1"
    >
  > &
    Pick<CallResolutionHypothesisServiceOptions, "calibrationRecords">;
  private readonly configurationHash: string;
  private readonly indexes = new WeakMap<object, IndexedWorkspace>();

  constructor(options: CallResolutionHypothesisServiceOptions = {}) {
    const merged = {
      maxCandidates: options.maxCandidates ?? DEFAULTS.maxCandidates,
      minimumIndependentGroups:
        options.minimumIndependentGroups ?? DEFAULTS.minimumIndependentGroups,
      minimumConfidenceLowerBound:
        options.minimumConfidenceLowerBound ??
        DEFAULTS.minimumConfidenceLowerBound,
      targetFamilyMacroTop1:
        options.targetFamilyMacroTop1 ?? DEFAULTS.targetFamilyMacroTop1,
    };
    if (!Number.isInteger(merged.maxCandidates) || merged.maxCandidates < 1)
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "maxCandidates must be a positive integer.",
      );
    if (
      !Number.isInteger(merged.minimumIndependentGroups) ||
      merged.minimumIndependentGroups < 1
    ) {
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "minimumIndependentGroups must be a positive integer.",
      );
    }
    if (!isFiniteRatio(merged.minimumConfidenceLowerBound))
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "minimumConfidenceLowerBound must be finite in [0, 1].",
      );
    if (!isFiniteRatio(merged.targetFamilyMacroTop1))
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "targetFamilyMacroTop1 must be finite in [0, 1].",
      );
    const calibrationRecords = options.calibrationRecords
      ? deepFreeze(structuredClone(options.calibrationRecords))
      : undefined;
    this.options = { ...merged, calibrationRecords };
    this.configurationHash = hash({
      ...configurationPolicy(),
      options: merged,
    });
  }

  indexWorkspace(
    input: CallResolutionHypothesisWorkspaceInput,
  ): CallResolutionHypothesisWorkspaceIndex {
    validateWorkspaceInput(input);
    const sourceFiles = deepFreeze(structuredClone(input.sourceFiles));
    const boundSourceFingerprint = hash({
      manifestFingerprint: input.sourceFingerprint,
      sourceFiles,
    });
    const candidates = new Map<string, MutableCandidate>();
    const memberNames = new Map<string, Set<string>>();
    const factsByFile = new Map<string, readonly AstDeclaredTypeFact[]>();
    const seenPaths = new Set<string>();
    let complete = input.sourceIndexComplete && sourceFiles.length > 0;
    let duplicateSourcePaths = false;

    for (const source of sourceFiles) {
      if (seenPaths.has(source.filePath)) {
        complete = false;
        duplicateSourcePaths = true;
        continue;
      }
      seenPaths.add(source.filePath);
      const facts = source.declaredTypeFacts;
      if (!facts) {
        complete = false;
        factsByFile.set(source.filePath, []);
        continue;
      }
      if (
        facts.schemaVersion !== AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION ||
        !["typescript", "tsx", "javascript"].includes(facts.language)
      ) {
        complete = false;
      }
      factsByFile.set(source.filePath, facts.facts);
      if (facts.ownerInventories.some((inventory) => !inventory.complete))
        complete = false;

      for (const declaration of facts.declarations) {
        if (
          !declaration.name ||
          !["class", "interface", "object"].includes(declaration.owner.kind) ||
          !["field", "method", "getter", "setter", "unknown"].includes(
            declaration.kind,
          )
        ) {
          continue;
        }
        const key = ownerMembersKey(
          source.filePath,
          declaration.owner,
          declaration.isStatic,
        );
        const names = memberNames.get(key) ?? new Set<string>();
        names.add(declaration.name);
        memberNames.set(key, names);
      }

      for (const declaration of facts.declarations) {
        const name = declaration.name;
        if (!name) continue;
        const ownerKind = declaration.owner.kind;
        const member =
          ["class", "interface", "object"].includes(ownerKind) &&
          ["field", "method", "getter", "setter", "unknown"].includes(
            declaration.kind,
          );
        const bareFunction =
          ["program", "function"].includes(ownerKind) &&
          declaration.kind === "function";
        if (!member && !bareFunction) continue;
        const key = targetKey(
          source.filePath,
          declaration.owner,
          name,
          member ? declaration.isStatic : false,
          bareFunction ? declaration.declarationSpan : undefined,
        );
        const inventoryComplete = member
          ? ownerInventoryComplete(facts, declaration.owner)
          : true;
        const existing = candidates.get(key);
        if (existing) {
          existing.declarations.push(declaration);
          existing.inventoryComplete &&= inventoryComplete;
        } else {
          candidates.set(key, {
            filePath: source.filePath,
            owner: declaration.owner,
            memberName: name,
            isStatic: member ? declaration.isStatic : false,
            declarations: [declaration],
            sourceLanguage: facts.language,
            inventoryComplete,
            targetKey: key,
          });
        }
      }
    }

    const frozenCandidates = [...candidates.values()]
      .map((candidate) => {
        if (!candidate.inventoryComplete) complete = false;
        candidate.declarations.sort(
          (left, right) =>
            left.declarationSpan.start - right.declarationSpan.start ||
            left.declarationSpan.end - right.declarationSpan.end,
        );
        return deepFreeze({
          targetKey: candidate.targetKey,
          filePath: candidate.filePath,
          owner: candidate.owner,
          memberName: candidate.memberName,
          isStatic: candidate.isStatic,
          declarationSpans: candidate.declarations.map(
            ({ declarationSpan }) => declarationSpan,
          ),
          declarations: candidate.declarations,
          sourceLanguage: candidate.sourceLanguage,
          inventoryComplete: candidate.inventoryComplete,
        }) satisfies CandidateWithoutRank;
      })
      .sort(
        (left, right) =>
          left.memberName.localeCompare(right.memberName) ||
          left.filePath.localeCompare(right.filePath) ||
          left.owner.span.start - right.owner.span.start ||
          Number(left.isStatic) - Number(right.isStatic) ||
          left.targetKey.localeCompare(right.targetKey),
      );
    const candidatesByMember = new Map<string, CandidateWithoutRank[]>();
    for (const candidate of frozenCandidates) {
      const list = candidatesByMember.get(candidate.memberName) ?? [];
      list.push(candidate);
      candidatesByMember.set(candidate.memberName, list);
    }
    for (const list of candidatesByMember.values()) deepFreeze(list);

    const handle = Object.freeze({
      schemaVersion: CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
      sourceFingerprint: boundSourceFingerprint,
      candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
      configurationHash: this.configurationHash,
    }) satisfies CallResolutionHypothesisWorkspaceIndex;
    this.indexes.set(
      handle,
      Object.freeze({
        handle,
        complete,
        candidatesByMember,
        memberNamesByTargetKey: new Map(
          frozenCandidates.map((candidate) => {
            const key = ownerMembersKey(
              candidate.filePath,
              candidate.owner,
              candidate.isStatic,
            );
            return [
              candidate.targetKey,
              memberNames.get(key) ?? new Set<string>(),
            ];
          }),
        ),
        factsByFile,
        duplicateSourcePaths,
      }),
    );
    return handle;
  }

  hypothesize(
    request: CallResolutionHypothesisRequest,
  ): CallResolutionHypothesisResult {
    validateRequest(request);
    const workspace = this.indexes.get(request.workspaceIndex);
    if (!workspace)
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "workspaceIndex must come from this service instance.",
      );
    const indexedCandidates =
      workspace.candidatesByMember.get(request.callSite.calleeName) ?? [];
    const receiverFact = receiverTypeFact(workspace, request);
    const receiverTypeName = receiverFact?.typeName ?? null;
    const factsForCaller =
      workspace.factsByFile.get(request.callerFilePath) ?? [];
    const generated = indexedCandidates
      .map((candidate) => {
        const signals: string[] = [];
        let rankScore = 0;
        if (
          receiverTypeName &&
          relationMatchesReceiver(
            candidate,
            workspace.factsByFile.get(candidate.filePath) ?? [],
            receiverTypeName,
          )
        ) {
          rankScore += RANKING_WEIGHTS.explicitReceiverType;
          signals.push("explicit-receiver-type");
        }
        const names = workspace.memberNamesByTargetKey.get(candidate.targetKey);
        if (
          request.callSite.peerMemberNames.length > 0 &&
          names &&
          request.callSite.peerMemberNames.every((name) => names.has(name))
        ) {
          rankScore += RANKING_WEIGHTS.peerMembers;
          signals.push("same-binding-peer-members");
        }
        const count = request.callSite.argumentCount;
        if (count !== null) {
          const arities = candidate.declarations
            .map((declaration) => compatibleArity(declaration, count))
            .filter((value): value is boolean => value !== undefined);
          if (arities.length > 0 && arities.some(Boolean)) {
            rankScore += RANKING_WEIGHTS.compatibleArity;
            signals.push("compatible-argument-count");
          }
        }
        const callerDirectory = request.callerFilePath
          .split("/")
          .slice(0, -1)
          .join("/");
        const candidateDirectory = candidate.filePath
          .split("/")
          .slice(0, -1)
          .join("/");
        if (callerDirectory === candidateDirectory) {
          rankScore += RANKING_WEIGHTS.sameDirectory;
          signals.push("same-directory");
        }
        return { ...candidate, rankScore, rankingSignals: signals };
      })
      .sort(
        (left, right) =>
          right.rankScore - left.rankScore ||
          left.filePath.localeCompare(right.filePath) ||
          left.owner.span.start - right.owner.span.start ||
          Number(left.isStatic) - Number(right.isStatic) ||
          left.targetKey.localeCompare(right.targetKey),
      );

    const pattern = rulePattern(
      request,
      workspace,
      indexedCandidates,
      receiverFact,
    );
    const ruleSignature = hash({
      configurationHash: this.configurationHash,
      pattern,
    });
    const featureInputHash = hash(
      featureInput(request, workspace, generated, receiverFact),
    );

    let current = generated;
    const visibilityInput = current.length;
    const visible = current.filter((candidate) => {
      const privateMember = candidate.declarations.some(
        (declaration) => declaration.visibility === "private",
      );
      if (!privateMember) return true;
      const callerType = request.callSite.callerType;
      return Boolean(
        callerType &&
        request.callerFilePath === candidate.filePath &&
        callerType.name === candidate.owner.name &&
        callerType.span.start === candidate.owner.span.start &&
        callerType.span.end === candidate.owner.span.end,
      );
    });
    const visibilityApplied = visible.length !== current.length;
    current = visible;
    const visibilityStage = stage(
      visibilityInput,
      current.length,
      visibilityApplied,
    );

    const explicitMatches = receiverTypeName
      ? current.filter((candidate) =>
          relationMatchesReceiver(
            candidate,
            workspace.factsByFile.get(candidate.filePath) ?? [],
            receiverTypeName,
          ),
        )
      : [];
    const explicitApplied =
      explicitMatches.length > 0 && explicitMatches.length < current.length;
    const explicitInput = current.length;
    if (explicitApplied) current = explicitMatches;
    const explicitStage = stage(explicitInput, current.length, explicitApplied);

    const peerNames = request.callSite.peerMemberNames;
    const peerMatches =
      peerNames.length === 0
        ? []
        : current.filter((candidate) => {
            if (!candidate.inventoryComplete) return true;
            const names = workspace.memberNamesByTargetKey.get(
              candidate.targetKey,
            );
            return Boolean(names && peerNames.every((name) => names.has(name)));
          });
    const peerApplied =
      peerNames.length > 0 &&
      peerMatches.length > 0 &&
      peerMatches.length < current.length;
    const peerInput = current.length;
    if (peerApplied) current = peerMatches;
    const peerStage = stage(peerInput, current.length, peerApplied);

    const argumentCount = request.callSite.argumentCount;
    const arityMatches =
      argumentCount === null || request.callSite.hasSpreadArgument
        ? []
        : current.filter((candidate) => {
            if (candidate.sourceLanguage === "javascript") return true;
            if (!candidate.inventoryComplete) return true;
            const compatible = candidate.declarations
              .map((declaration) => compatibleArity(declaration, argumentCount))
              .filter((value): value is boolean => value !== undefined);
            return compatible.length === 0 || compatible.some(Boolean);
          });
    const arityApplied =
      arityMatches.length > 0 && arityMatches.length < current.length;
    const arityInput = current.length;
    if (arityApplied) current = arityMatches;
    const arityStage = stage(arityInput, current.length, arityApplied);

    const truncated = current.length > this.options.maxCandidates;
    const proposals = current.slice(0, this.options.maxCandidates);
    const unsupportedCallShape =
      !workspace.factsByFile.has(request.callerFilePath) ||
      request.callSite.calleeKind === "arg-chain" ||
      ((request.callSite.calleeKind === "member" ||
        request.callSite.calleeKind === "this") &&
        request.callSite.receiverBinding === null);
    const matchingRecords = this.options.calibrationRecords?.filter(
      (record) => record.ruleSignature === ruleSignature,
    );
    const calibration = matchingRecords?.find((record) =>
      calibrationRecordIsValid(
        record,
        this.options,
        ruleSignature,
        this.configurationHash,
      ),
    );

    let reason: CallResolutionHypothesisResult["reason"];
    let status: CallResolutionHypothesisResult["status"] = "ambiguous";
    let selected: CallResolutionHypothesisCandidate | null = null;
    let confidence: number | null = null;
    if (proposals.length === 0) {
      reason = "no-supported-candidates";
    } else if (unsupportedCallShape) {
      reason = "unsupported-call-shape";
    } else if (!workspace.complete) {
      reason = "incomplete-inventory";
    } else if (truncated) {
      reason = "candidate-list-truncated";
    } else if (!calibration) {
      reason = matchingRecords?.length
        ? "calibration-rejected"
        : "uncalibrated-signature";
    } else {
      const top = proposals[0];
      const tied = proposals[1]?.rankScore === top?.rankScore;
      if (top && !tied && top.rankScore >= calibration.thresholdScore) {
        const validConfidence = calibration.confidenceLowerBound;
        if (
          Number.isFinite(validConfidence) &&
          isFiniteRatio(validConfidence)
        ) {
          status = "likely";
          selected = top;
          confidence = validConfidence;
          reason = "calibrated-likely";
        } else {
          reason = "calibration-rejected";
        }
      } else {
        reason = "calibration-rejected";
      }
    }

    return {
      schemaVersion: CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
      candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
      configurationHash: this.configurationHash,
      sourceFingerprint: workspace.handle.sourceFingerprint,
      featureInputHash,
      ruleSignature,
      candidateSetComplete: workspace.complete,
      truncated,
      generatedCandidateKeys: indexedCandidates.map(
        ({ targetKey: key }) => key,
      ),
      candidates: proposals,
      filterStages: {
        visibility: visibilityStage,
        explicitReceiverType: explicitStage,
        peerMembers: peerStage,
        argumentShape: arityStage,
      },
      status,
      selected,
      confidence,
      reason,
    };
  }
}
