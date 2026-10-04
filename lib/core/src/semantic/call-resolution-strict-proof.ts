import type {
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisRequest,
  CallResolutionStrictProof,
} from "@workspace/contracts";
import {
  getReceiverTypeFact,
  type IndexedWorkspace,
} from "./call-resolution-hypothesis-index.js";
import { hash } from "./call-resolution-hypothesis-internal.js";

const SINGLE_CANDIDATE_THIS_RULE = "single-candidate-this-v1" as const;

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

function abstain(
  reason: Exclude<
    CallResolutionStrictProof["reason"],
    "unique-this-owner-member"
  >,
): CallResolutionStrictProof {
  return {
    status: "abstained",
    targetKey: null,
    ruleSignature: null,
    reason,
  };
}
