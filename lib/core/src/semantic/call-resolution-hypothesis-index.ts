import type {
  AstDeclaredDeclaration,
  AstDeclaredTypeFact,
  AstDeclaredTypeFacts,
  AstDeclaredTypeOwner,
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisWorkspaceIndex,
  CallResolutionHypothesisWorkspaceInput,
} from "@workspace/contracts";
import {
  AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
} from "@workspace/contracts";
import {
  CandidateWithoutRank,
  deepFreeze,
  hash,
  validateWorkspaceInput,
} from "./call-resolution-hypothesis-internal.js";

export interface IndexedWorkspace {
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

interface WorkspaceBuilder {
  complete: boolean;
  duplicateSourcePaths: boolean;
  readonly seenPaths: Set<string>;
  readonly candidates: Map<string, MutableCandidate>;
  readonly memberNames: Map<string, Set<string>>;
  readonly factsByFile: Map<string, readonly AstDeclaredTypeFact[]>;
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

function inventoryIsComplete(
  facts: AstDeclaredTypeFacts,
  owner: AstDeclaredTypeOwner,
): boolean {
  return (
    facts.ownerInventories.find(
      (inventory) => ownerKey(inventory.owner) === ownerKey(owner),
    )?.complete ?? false
  );
}

function supportedDeclaration(declaration: AstDeclaredDeclaration): boolean {
  return (
    declaration.name !== null &&
    ["class", "interface", "object"].includes(declaration.owner.kind) &&
    ["field", "method", "getter", "setter", "unknown"].includes(
      declaration.kind,
    )
  );
}

function memberNameIndexKey(
  filePath: string,
  declaration: AstDeclaredDeclaration,
): string {
  return ownerMembersKey(filePath, declaration.owner, declaration.isStatic);
}

function targetForDeclaration(
  filePath: string,
  declaration: AstDeclaredDeclaration,
): string | undefined {
  const name = declaration.name;
  if (!name) return undefined;
  const isMember = supportedDeclaration(declaration);
  const isBareFunction =
    ["program", "function"].includes(declaration.owner.kind) &&
    declaration.kind === "function";
  if (!isMember && !isBareFunction) return undefined;
  return targetKey(
    filePath,
    declaration.owner,
    name,
    isMember ? declaration.isStatic : false,
    isBareFunction ? declaration.declarationSpan : undefined,
  );
}

function indexOwnerMemberNames(
  builder: WorkspaceBuilder,
  filePath: string,
  facts: AstDeclaredTypeFacts,
): void {
  for (const declaration of facts.declarations) {
    if (!supportedDeclaration(declaration) || !declaration.name) continue;
    const key = memberNameIndexKey(filePath, declaration);
    const names = builder.memberNames.get(key) ?? new Set<string>();
    names.add(declaration.name);
    builder.memberNames.set(key, names);
  }
}

function addCandidate(
  builder: WorkspaceBuilder,
  sourceFilePath: string,
  facts: AstDeclaredTypeFacts,
  declaration: AstDeclaredDeclaration,
): void {
  const key = targetForDeclaration(sourceFilePath, declaration);
  if (!key || !declaration.name) return;
  const isMember = supportedDeclaration(declaration);
  const inventoryComplete =
    !isMember || inventoryIsComplete(facts, declaration.owner);
  const existing = builder.candidates.get(key);
  if (existing) {
    existing.declarations.push(declaration);
    existing.inventoryComplete &&= inventoryComplete;
    return;
  }
  builder.candidates.set(key, {
    filePath: sourceFilePath,
    owner: declaration.owner,
    memberName: declaration.name,
    isStatic: isMember && declaration.isStatic,
    declarations: [declaration],
    sourceLanguage: facts.language,
    inventoryComplete,
    targetKey: key,
  });
}

function indexDeclarations(
  builder: WorkspaceBuilder,
  filePath: string,
  facts: AstDeclaredTypeFacts,
): void {
  indexOwnerMemberNames(builder, filePath, facts);
  for (const declaration of facts.declarations)
    addCandidate(builder, filePath, facts, declaration);
}

function indexSourceFile(
  builder: WorkspaceBuilder,
  source: CallResolutionHypothesisWorkspaceInput["sourceFiles"][number],
): void {
  if (builder.seenPaths.has(source.filePath)) {
    builder.complete = false;
    builder.duplicateSourcePaths = true;
    return;
  }
  builder.seenPaths.add(source.filePath);
  const facts = source.declaredTypeFacts;
  if (!facts) {
    builder.complete = false;
    builder.factsByFile.set(source.filePath, []);
    return;
  }
  builder.factsByFile.set(source.filePath, facts.facts);
  if (
    facts.schemaVersion !== AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION ||
    !["typescript", "tsx", "javascript"].includes(facts.language) ||
    facts.ownerInventories.some((inventory) => !inventory.complete)
  ) {
    builder.complete = false;
  }
  indexDeclarations(builder, source.filePath, facts);
}

function freezeCandidate(candidate: MutableCandidate): CandidateWithoutRank {
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
  });
}

function sortedCandidates(builder: WorkspaceBuilder): CandidateWithoutRank[] {
  const candidates = [...builder.candidates.values()].map(freezeCandidate);
  for (const candidate of candidates) {
    if (!candidate.inventoryComplete) builder.complete = false;
  }
  return candidates.sort(
    (left, right) =>
      left.memberName.localeCompare(right.memberName) ||
      left.filePath.localeCompare(right.filePath) ||
      left.owner.span.start - right.owner.span.start ||
      Number(left.isStatic) - Number(right.isStatic) ||
      left.targetKey.localeCompare(right.targetKey),
  );
}

function candidateMemberMap(
  candidates: readonly CandidateWithoutRank[],
): Map<string, CandidateWithoutRank[]> {
  const result = new Map<string, CandidateWithoutRank[]>();
  for (const candidate of candidates) {
    const list = result.get(candidate.memberName) ?? [];
    list.push(candidate);
    result.set(candidate.memberName, list);
  }
  for (const list of result.values()) deepFreeze(list);
  return result;
}

function workspaceBuilder(
  input: CallResolutionHypothesisWorkspaceInput,
): WorkspaceBuilder {
  return {
    complete: input.sourceIndexComplete && input.sourceFiles.length > 0,
    duplicateSourcePaths: false,
    seenPaths: new Set(),
    candidates: new Map(),
    memberNames: new Map(),
    factsByFile: new Map(),
  };
}

export function createIndexedWorkspace(
  input: CallResolutionHypothesisWorkspaceInput,
  configurationHash: string,
): IndexedWorkspace {
  validateWorkspaceInput(input);
  const sourceFiles = deepFreeze(structuredClone(input.sourceFiles));
  const boundSourceFingerprint = hash({
    manifestFingerprint: input.sourceFingerprint,
    sourceFiles,
  });
  const builder = workspaceBuilder(input);
  for (const source of sourceFiles) indexSourceFile(builder, source);
  const candidates = sortedCandidates(builder);
  const candidatesByMember = candidateMemberMap(candidates);
  const handle = Object.freeze({
    schemaVersion: CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
    sourceFingerprint: boundSourceFingerprint,
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    configurationHash,
  }) satisfies CallResolutionHypothesisWorkspaceIndex;
  const memberNamesByTargetKey = new Map<string, ReadonlySet<string>>();
  for (const candidate of candidates) {
    const key = ownerMembersKey(
      candidate.filePath,
      candidate.owner,
      candidate.isStatic,
    );
    memberNamesByTargetKey.set(
      candidate.targetKey,
      builder.memberNames.get(key) ?? new Set<string>(),
    );
  }
  return Object.freeze({
    handle,
    complete: builder.complete,
    candidatesByMember,
    memberNamesByTargetKey,
    factsByFile: builder.factsByFile,
    duplicateSourcePaths: builder.duplicateSourcePaths,
  });
}

export function getReceiverTypeFact(
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

export function candidateMatchesReceiver(
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

export function createRuleSignature(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  candidates: readonly CandidateWithoutRank[],
  receiverFact: AstDeclaredTypeFact | undefined,
  configurationHash: string,
): string {
  const pattern = {
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    callShape: request.callSite.calleeKind,
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
  return hash({ configurationHash, pattern });
}

export function hashFeatureInput(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  candidates: readonly CallResolutionHypothesisCandidate[],
  receiverFact: AstDeclaredTypeFact | undefined,
): string {
  return hash({
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
  });
}
