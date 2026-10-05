import type {
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisSourceFile,
  CallResolutionStrictProof,
} from "@workspace/contracts";
import {
  getReceiverTypeFact,
  isWorkspaceBoundSourcePath,
  candidateTargetKeyForDeclaration,
  resolveDirectConfiguredImportPath,
  resolveDirectRelativeImportPath,
  type IndexedWorkspace,
} from "./call-resolution-hypothesis-index.js";
import { HASH_PATTERN, hash } from "./call-resolution-hypothesis-internal.js";

const NAMED_IMPORT_RULE = "q1:named-import:v1" as const;

const SINGLE_CANDIDATE_THIS_RULE = "single-candidate-this-v1" as const;

type NamedImportBinding = NonNullable<
  CallResolutionHypothesisRequest["callSite"]["calleeBinding"]
> & { readonly kind: "import" };
type ImportDescriptor = NonNullable<
  CallResolutionHypothesisSourceFile["imports"]
>[number];
type CompleteQ1Target = CallResolutionHypothesisSourceFile & {
  readonly sourceContentHash: string;
  readonly exports: NonNullable<CallResolutionHypothesisSourceFile["exports"]>;
  readonly declaredTypeFacts: NonNullable<
    CallResolutionHypothesisSourceFile["declaredTypeFacts"]
  >;
};

function sameSpan(
  left: { readonly start: number; readonly end: number },
  right: { readonly start: number; readonly end: number },
): boolean {
  return left.start === right.start && left.end === right.end;
}

function hasSupportedThisShape(
  callSite: CallResolutionHypothesisRequest["callSite"],
): boolean {
  const binding = callSite.receiverBinding;
  const callerType = callSite.callerType;
  return Boolean(
    callSite.calleeKind === "this" &&
    binding?.kind === "this" &&
    binding.name === "this" &&
    callerType &&
    sameSpan(binding.declarationSpan, callerType.span) &&
    sameSpan(binding.scopeSpan, callerType.span),
  );
}

function sourceSnapshotAbstentionReason(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): "source-snapshot-unbound" | "source-snapshot-mismatch" | null {
  const indexedHash = workspace.sourceContentHashByFile.get(
    request.callerFilePath,
  );
  const callerHash = request.callerSourceContentHash;
  if (!indexedHash || !callerHash) return "source-snapshot-unbound";
  if (indexedHash !== callerHash) return "source-snapshot-mismatch";
  return null;
}

function hasOneIndexedCallSite(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): boolean {
  const callSites = workspace.callSiteShapesByFile.get(request.callerFilePath);
  if (!callSites) return false;
  const requestedHash = hash(request.callSite);
  return (
    callSites.filter((callSite) => hash(callSite) === requestedHash).length ===
    1
  );
}

function hasInstanceMethodCaller(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): boolean {
  const callerType = request.callSite.callerType;
  if (!callerType) return false;
  const declarations = workspace.declarationsByFile.get(request.callerFilePath);
  if (!declarations) return false;
  const callers = declarations.filter((declaration) => {
    const owner = declaration.owner;
    return (
      sameSpan(
        declaration.declarationSpan,
        request.callSite.lexicalScopeSpan,
      ) &&
      ["method", "constructor", "getter", "setter"].includes(
        declaration.kind,
      ) &&
      owner.kind === "class" &&
      owner.name === callerType.name &&
      sameSpan(owner.span, callerType.span)
    );
  });
  return callers.length === 1 && callers[0]?.isStatic === false;
}

function isExactOwnerCandidate(
  candidate: CallResolutionHypothesisCandidate,
  request: CallResolutionHypothesisRequest,
): boolean {
  const callerType = request.callSite.callerType;
  return Boolean(
    callerType &&
    candidate.filePath === request.callerFilePath &&
    candidate.memberName === request.callSite.calleeName &&
    candidate.owner.kind === "class" &&
    candidate.owner.name === callerType.name &&
    sameSpan(candidate.owner.span, callerType.span) &&
    !candidate.isStatic,
  );
}

function hasOneConcreteOwnerMethod(
  candidate: CallResolutionHypothesisCandidate,
  callerType: CallResolutionHypothesisRequest["callSite"]["callerType"],
): boolean {
  const [declaration] = candidate.declarations;
  return Boolean(
    candidate.declarations.length === 1 &&
    declaration &&
    callerType &&
    declaration.kind === "method" &&
    !declaration.isStatic &&
    declaration.owner.kind === "class" &&
    declaration.owner.name === callerType.name &&
    sameSpan(declaration.owner.span, callerType.span),
  );
}

function abstainForUnresolvedTypeBinding(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): CallResolutionStrictProof | null {
  if (
    request.callSite.calleeKind !== "member" ||
    !request.callSite.receiverBinding ||
    !getReceiverTypeFact(workspace, request)
  )
    return null;

  const sourceReason = sourceSnapshotAbstentionReason(request, workspace);
  if (sourceReason) return abstain(sourceReason);
  if (!hasOneIndexedCallSite(request, workspace))
    return abstain("call-site-not-in-indexed-source");
  return abstain("unresolved-type-binding");
}

function abstainForUnresolvedCallBinding(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): CallResolutionStrictProof | null {
  const callSite = request.callSite;
  if (
    callSite.calleeKind !== "bare" &&
    !(callSite.calleeKind === "member" && !callSite.receiverBinding)
  )
    return null;

  const sourceReason = sourceSnapshotAbstentionReason(request, workspace);
  if (sourceReason) return abstain(sourceReason);
  if (!hasOneIndexedCallSite(request, workspace))
    return abstain("call-site-not-in-indexed-source");
  return abstain("unresolved-call-binding");
}

function isQ1NamedImportRequest(
  request: CallResolutionHypothesisRequest,
): boolean {
  return (
    request.callSite.calleeKind === "bare" &&
    request.callSite.calleeBinding?.kind === "import"
  );
}

function namedImportPreconditionAbstention(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof | null {
  const sourceReason = sourceSnapshotAbstentionReason(request, workspace);
  if (sourceReason) return abstain(sourceReason);
  if (!hasOneIndexedCallSite(request, workspace))
    return abstain("call-site-not-in-indexed-source");
  if (
    !workspace.namedFunctionInventoryComplete ||
    workspace.duplicateSourcePaths
  )
    return abstain("incomplete-inventory");
  if (truncated) return abstain("candidate-list-truncated");
  if (!isWorkspaceBoundSourcePath(request.callerFilePath))
    return abstain("unsupported-call-shape");
  return null;
}

function hasSupportedImportModulePath(modulePath: string): boolean {
  return (
    modulePath.startsWith("./") ||
    modulePath.startsWith("../") ||
    modulePath.startsWith("@/")
  );
}

function isSupportedNamedImportDescriptor(
  descriptor: ImportDescriptor,
  request: CallResolutionHypothesisRequest,
  binding: NamedImportBinding,
): boolean {
  return (
    descriptor.localName === request.callSite.calleeName &&
    descriptor.localName === binding.name &&
    !descriptor.viaReexport &&
    !descriptor.isTypeOnly &&
    !descriptor.isCombinedDefaultImport &&
    descriptor.originalName !== "*" &&
    descriptor.originalName !== "default" &&
    hasSupportedImportModulePath(descriptor.modulePath)
  );
}

function getUniqueNamedImportDescriptor(
  request: CallResolutionHypothesisRequest,
  caller: CallResolutionHypothesisSourceFile,
  binding: NamedImportBinding,
): ImportDescriptor | null {
  const imports = caller.imports;
  if (!imports) return null;
  const localBindings = imports.filter(
    ({ localName }) => localName === request.callSite.calleeName,
  );
  if (localBindings.length !== 1) return null;
  const [descriptor] = localBindings;
  if (
    !descriptor ||
    !isSupportedNamedImportDescriptor(descriptor, request, binding)
  )
    return null;
  const sameImportAliases = imports.filter(
    (candidate) =>
      candidate.modulePath === descriptor.modulePath &&
      candidate.originalName === descriptor.originalName,
  );
  return sameImportAliases.length === 1 ? descriptor : null;
}

function resolveNamedImportTargetPath(
  request: CallResolutionHypothesisRequest,
  descriptor: ImportDescriptor,
  workspace: IndexedWorkspace,
): string | null {
  const availableFilePaths = [...workspace.sourceFilesByPath.keys()];
  const isRelative =
    descriptor.modulePath.startsWith("./") ||
    descriptor.modulePath.startsWith("../");
  const relativeTargetPath = isRelative
    ? resolveDirectRelativeImportPath(
        request.callerFilePath,
        descriptor.modulePath,
        availableFilePaths,
        true,
      )
    : undefined;
  const configuredTargetPath = relativeTargetPath
    ? undefined
    : resolveDirectConfiguredImportPath(
        request.callerFilePath,
        descriptor.modulePath,
        availableFilePaths,
        workspace.configuredPathAliases,
        true,
      );
  const targetPath = relativeTargetPath ?? configuredTargetPath;
  return targetPath && isWorkspaceBoundSourcePath(targetPath)
    ? targetPath
    : null;
}

function getCompleteQ1Target(
  targetPath: string,
  workspace: IndexedWorkspace,
): CompleteQ1Target | null {
  const target = workspace.sourceFilesByPath.get(targetPath);
  if (
    !target ||
    !target.sourceContentHash ||
    !HASH_PATTERN.test(target.sourceContentHash) ||
    !target.exports ||
    !target.declaredTypeFacts
  ) {
    return null;
  }
  return target as CompleteQ1Target;
}

function isNamedReexport(candidate: ImportDescriptor, name: string): boolean {
  return (
    Boolean(candidate.viaReexport) &&
    (candidate.localName === name || candidate.originalName === name)
  );
}

function isDirectFunctionDeclaration(
  declaration: NonNullable<
    CallResolutionHypothesisSourceFile["declaredTypeFacts"]
  >["declarations"][number],
  name: string,
): boolean {
  return (
    declaration.name === name &&
    declaration.owner.kind === "program" &&
    declaration.kind === "function" &&
    !declaration.unsupportedReason
  );
}

function hasSingleNamedFunctionExport(
  target: CallResolutionHypothesisSourceFile,
  name: string,
): boolean {
  const namedExports = target.exports?.filter((item) => item.name === name);
  return namedExports?.length === 1 && namedExports[0]?.type === "function";
}

function hasNamedReexport(
  target: CallResolutionHypothesisSourceFile,
  name: string,
): boolean {
  return Boolean(
    target.imports?.some((candidate) => isNamedReexport(candidate, name)),
  );
}

function getUniqueDirectFunctionDeclaration(
  target: CompleteQ1Target,
  name: string,
) {
  return target.declaredTypeFacts.declarations.filter((declaration) =>
    isDirectFunctionDeclaration(declaration, name),
  );
}

type NamedImportDeclarationResult =
  | {
      readonly status: "ready";
      readonly declaration: ReturnType<
        typeof getUniqueDirectFunctionDeclaration
      >[number];
    }
  | {
      readonly status: "abstained";
      readonly reason: "unresolved-call-binding" | "no-unique-owner-candidate";
    };

function getUniqueDirectNamedFunctionDeclaration(
  target: CompleteQ1Target,
  name: string,
): NamedImportDeclarationResult {
  if (
    !hasSingleNamedFunctionExport(target, name) ||
    hasNamedReexport(target, name)
  )
    return { status: "abstained", reason: "unresolved-call-binding" };
  const declarations = getUniqueDirectFunctionDeclaration(target, name);
  if (declarations.length === 0)
    return { status: "abstained", reason: "unresolved-call-binding" };
  if (declarations.length !== 1 || !declarations[0])
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  return { status: "ready", declaration: declarations[0] };
}

function hasUniqueNamedImportCandidate(
  workspace: IndexedWorkspace,
  name: string,
  targetPath: string,
  targetKey: string,
): boolean {
  const sameNameFunctions = (
    workspace.candidatesByMember.get(name) ?? []
  ).filter(
    (candidate) =>
      candidate.owner.kind === "program" &&
      candidate.declarations.some(
        ({ name: declarationName }) => declarationName === name,
      ),
  );
  return (
    sameNameFunctions.length === 1 &&
    sameNameFunctions[0]?.filePath === targetPath &&
    sameNameFunctions[0]?.targetKey === targetKey &&
    sameNameFunctions[0]?.inventoryComplete === true
  );
}

function namedImportDependencies(
  request: CallResolutionHypothesisRequest,
  callerHash: string,
  targetPath: string,
  targetHash: string,
  usesConfiguredPath: boolean,
  workspace: IndexedWorkspace,
) {
  const dependenciesByPath = new Map([
    [request.callerFilePath, callerHash],
    [targetPath, targetHash],
  ]);
  if (usesConfiguredPath && workspace.configuredPathAliases) {
    dependenciesByPath.set(
      workspace.configuredPathAliases.configurationFilePath,
      workspace.configuredPathAliases.sourceContentHash,
    );
  }
  return [...dependenciesByPath]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, contentHash]) => ({ filePath, contentHash }));
}

interface NamedImportResolutionContext {
  readonly callerHash: string;
  readonly descriptor: ImportDescriptor;
  readonly targetPath: string;
}

function getNamedImportResolutionContext(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): NamedImportResolutionContext | null {
  const caller = workspace.sourceFilesByPath.get(request.callerFilePath);
  const callerHash = caller?.sourceContentHash;
  const binding = request.callSite.calleeBinding;
  if (
    !caller ||
    !callerHash ||
    !HASH_PATTERN.test(callerHash) ||
    binding?.kind !== "import"
  ) {
    return null;
  }
  const descriptor = getUniqueNamedImportDescriptor(
    request,
    caller,
    binding as NamedImportBinding,
  );
  if (!descriptor) return null;
  const targetPath = resolveNamedImportTargetPath(
    request,
    descriptor,
    workspace,
  );
  return targetPath ? { callerHash, descriptor, targetPath } : null;
}

function proveResolvedNamedImport(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  context: NamedImportResolutionContext,
): CallResolutionStrictProof {
  const { descriptor, targetPath } = context;
  const target = getCompleteQ1Target(targetPath, workspace);
  if (!target) return abstain("incomplete-inventory");
  const declarationResult = getUniqueDirectNamedFunctionDeclaration(
    target,
    descriptor.originalName,
  );
  if (declarationResult.status === "abstained")
    return abstain(declarationResult.reason);
  const declaration = declarationResult.declaration;
  const candidateKey = candidateTargetKeyForDeclaration(
    targetPath,
    declaration,
  );
  if (!candidateKey) return abstain("no-unique-owner-candidate");
  if (
    !hasUniqueNamedImportCandidate(
      workspace,
      descriptor.originalName,
      targetPath,
      candidateKey,
    )
  ) {
    return abstain("no-unique-owner-candidate");
  }
  const dependencies = namedImportDependencies(
    request,
    context.callerHash,
    targetPath,
    target.sourceContentHash,
    descriptor.modulePath.startsWith("@/"),
    workspace,
  );
  return {
    status: "proven",
    targetKey: candidateKey,
    ruleSignature: NAMED_IMPORT_RULE,
    reason: "unique-named-import",
    targetFilePath: targetPath,
    targetName: descriptor.originalName,
    dependencies,
  };
}

function directNamedImportProof(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof | null {
  if (!isQ1NamedImportRequest(request)) return null;
  const precondition = namedImportPreconditionAbstention(
    request,
    workspace,
    truncated,
  );
  if (precondition) return precondition;
  const context = getNamedImportResolutionContext(request, workspace);
  if (!context) return abstain("unresolved-call-binding");
  return proveResolvedNamedImport(request, workspace, context);
}

function proveUnsupportedCallShape(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): CallResolutionStrictProof {
  return (
    abstainForUnresolvedTypeBinding(request, workspace) ??
    abstainForUnresolvedCallBinding(request, workspace) ??
    abstain("unsupported-call-shape")
  );
}

function thisMemberPreconditionAbstention(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof | null {
  if (!hasSupportedThisShape(request.callSite))
    return proveUnsupportedCallShape(request, workspace);
  if (!hasInstanceMethodCaller(request, workspace))
    return abstain("unsupported-call-shape");
  if (!workspace.complete) return abstain("incomplete-inventory");
  if (truncated) return abstain("candidate-list-truncated");

  const sourceReason = sourceSnapshotAbstentionReason(request, workspace);
  if (sourceReason) return abstain(sourceReason);
  if (!hasOneIndexedCallSite(request, workspace))
    return abstain("call-site-not-in-indexed-source");
  return null;
}

/**
 * Proves the narrow Q3 case where `this.member()` names one complete, non-static member
 * declared directly on the exact enclosing class. Every other call shape abstains until its
 * import, alias, receiver, and inheritance evidence has a dedicated strict resolver.
 */
export function proveUniqueThisMember(
  request: CallResolutionHypothesisRequest,
  candidates: readonly CallResolutionHypothesisCandidate[],
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof {
  const preconditionAbstention = thisMemberPreconditionAbstention(
    request,
    workspace,
    truncated,
  );
  if (preconditionAbstention) return preconditionAbstention;

  const ownerCandidates = candidates.filter((candidate) =>
    isExactOwnerCandidate(candidate, request),
  );
  if (ownerCandidates.length !== 1) return abstain("no-unique-owner-candidate");

  const [candidate] = ownerCandidates;
  if (!candidate) return abstain("no-unique-owner-candidate");
  if (!hasOneConcreteOwnerMethod(candidate, request.callSite.callerType)) {
    return abstain("ambiguous-owner-declaration");
  }
  if (!candidate?.inventoryComplete) return abstain("incomplete-inventory");
  return {
    status: "proven",
    targetKey: candidate.targetKey,
    ruleSignature: SINGLE_CANDIDATE_THIS_RULE,
    reason: "unique-this-owner-member",
  };
}

export function proveUniqueNamedImport(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof | null {
  return directNamedImportProof(request, workspace, truncated);
}

function abstain(
  reason: Exclude<
    CallResolutionStrictProof["reason"],
    "unique-this-owner-member" | "unique-named-import"
  >,
): CallResolutionStrictProof {
  return {
    status: "abstained",
    targetKey: null,
    ruleSignature: null,
    reason,
  };
}
