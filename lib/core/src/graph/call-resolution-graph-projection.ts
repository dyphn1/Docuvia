import { createHash } from "node:crypto";
import {
  type ICallResolutionHypothesisService,
  type CallResolutionHypothesisWorkspaceIndex,
  type CallResolutionStrictProof,
  type CallSiteResolutionRecord,
  type CallSiteResolutionObservationInput,
  type ParsedAstFileResult,
  CallSiteResolutionClasses,
  CallSiteResolutionObservationSources,
  CallSiteVerificationStatuses,
  CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
  createPortableCallSiteKey,
} from "@workspace/contracts";
import { candidateTargetKeyForDeclaration } from "../semantic/call-resolution-hypothesis-index.js";

export type FunctionNodeReference = {
  readonly nodeKey: string;
  readonly name: string;
  readonly containerName?: string;
  readonly startLine: number;
  readonly endLine: number;
};

export type CallSiteProof = {
  readonly callSiteKey: string;
  readonly resolution: CallSiteResolutionRecord;
  readonly strictObservation: CallSiteResolutionObservationInput;
};

type ParsedCall = NonNullable<ParsedAstFileResult["data"]["calls"]>[number];
type CallSiteShape = NonNullable<
  ParsedAstFileResult["data"]["callSiteShapeFacts"]
>["callSites"][number];
type Q3ReceiverRuleSignature =
  | typeof CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE
  | typeof CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE
  | typeof CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE
  | typeof CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE;
type Q3ReceiverProof = Extract<
  CallResolutionStrictProof,
  { ruleSignature: Q3ReceiverRuleSignature }
>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const Q3_RECEIVER_RULE_SIGNATURES = new Set<string>([
  CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isSha256(value: string): boolean {
  return SHA256_PATTERN.test(value);
}

/** Returns the parser-input hash used by proof bindings, falling back only for legacy callers whose existing hash is already SHA-256. */
export function sourceContentHashForProof(result: ParsedAstFileResult): string {
  return result.sourceContentHash ?? result.hash;
}

export function sourceManifestFingerprint(
  parsedResults: readonly ParsedAstFileResult[],
  sourceIndexComplete: boolean,
): string {
  const manifest = parsedResults
    .map((result) => ({
      file: result.file,
      hash: sourceContentHashForProof(result),
    }))
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.hash.localeCompare(right.hash),
    );
  return sha256(
    JSON.stringify({ schemaVersion: 1, sourceIndexComplete, manifest }),
  );
}

function sameCallShape(call: ParsedCall, shape: CallSiteShape): boolean {
  return (
    call.startLine === shape.startLine &&
    call.startColumn === shape.startColumn &&
    call.calleeName === shape.calleeName &&
    call.calleeKind === shape.calleeKind &&
    (call.receiverText ?? null) === shape.receiverText
  );
}

function uniqueCallSiteShape(
  call: ParsedCall,
  result: ParsedAstFileResult,
): CallSiteShape | undefined {
  const matches = (result.data.callSiteShapeFacts?.callSites ?? []).filter(
    (shape) => sameCallShape(call, shape),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function portableCallSiteKey(
  filePath: string,
  sourceContentHash: string,
  shape: CallSiteShape,
): string {
  return createPortableCallSiteKey({
    filePath,
    sourceContentHash,
    startLine: shape.startLine,
    startColumn: shape.startColumn,
    calleeKind: shape.calleeKind,
    calleeName: shape.calleeName,
  });
}

export function portableCallSiteKeyForCall(
  result: ParsedAstFileResult,
  call: ParsedCall,
): string | undefined {
  const sourceHash = sourceContentHashForProof(result);
  if (!isSha256(sourceHash)) return undefined;
  const shape = uniqueCallSiteShape(call, result);
  return shape
    ? portableCallSiteKey(result.file, sourceHash, shape)
    : undefined;
}

function strictTargetDeclaration(
  result: ParsedAstFileResult,
  targetKey: string,
) {
  const matches = (result.data.declaredTypeFacts?.declarations ?? []).filter(
    (declaration) =>
      candidateTargetKeyForDeclaration(result.file, declaration) === targetKey,
  );
  if (matches.length !== 1) return undefined;

  const [declaration] = matches;
  if (
    !declaration ||
    declaration.kind !== "method" ||
    declaration.owner.kind !== "class" ||
    !declaration.owner.name ||
    !declaration.name ||
    declaration.isStatic
  ) {
    return undefined;
  }
  return declaration;
}

function strictTargetFunction(
  result: ParsedAstFileResult,
  targetKey: string,
  functionNodes: readonly FunctionNodeReference[],
): FunctionNodeReference | undefined {
  const declaration = strictTargetDeclaration(result, targetKey);
  if (!declaration) return undefined;
  const matches = functionNodes.filter(
    (fn) =>
      fn.name === declaration.name &&
      fn.containerName === declaration.owner.name,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function callerFunctionForCall(
  call: ParsedCall,
  callSite: CallSiteShape,
  functionNodes: readonly FunctionNodeReference[],
): FunctionNodeReference | undefined {
  const matches = functionNodes.filter(
    (fn) =>
      fn.name === call.sourceFunction &&
      fn.containerName === callSite.callerType?.name &&
      fn.startLine <= callSite.startLine &&
      fn.endLine >= callSite.startLine,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function callerNodeForCall(
  result: ParsedAstFileResult,
  call: ParsedCall,
  callSite: CallSiteShape,
  functionNodes: readonly FunctionNodeReference[],
): FunctionNodeReference | undefined {
  const matchingCaller = callerFunctionForCall(call, callSite, functionNodes);
  if (matchingCaller) return matchingCaller;

  const enclosingFunctions = functionNodes.filter(
    (fn) => fn.startLine <= call.startLine && fn.endLine >= call.startLine,
  );
  if (enclosingFunctions.length > 0) {
    const smallestSpan = Math.min(
      ...enclosingFunctions.map((fn) => fn.endLine - fn.startLine),
    );
    const innermostFunctions = enclosingFunctions.filter(
      (fn) => fn.endLine - fn.startLine === smallestSpan,
    );
    if (innermostFunctions.length !== 1) return undefined;

    // Calls inside callbacks can carry a parameter or local name in sourceFunction
    // instead of the graph's enclosing function name. The unique smallest AST
    // function span identifies that caller without trusting the legacy hint.
    const [innermostFunction] = innermostFunctions;
    return innermostFunction;
  }
  return {
    nodeKey: result.file,
    name: result.file,
    startLine: call.startLine,
    endLine: call.startLine,
  };
}

function namedImportTargetFunction(
  proof: Extract<
    CallResolutionStrictProof,
    {
      ruleSignature:
        | "q1:named-import:v1"
        | typeof CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE;
    }
  >,
  functionNodesByFile: ReadonlyMap<string, readonly FunctionNodeReference[]>,
): FunctionNodeReference | undefined {
  const matches = (functionNodesByFile.get(proof.targetFilePath) ?? []).filter(
    (fn) => fn.name === proof.targetName && fn.containerName === undefined,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function q3TargetFunction(
  proof: Q3ReceiverProof,
  functionNodesByFile: ReadonlyMap<string, readonly FunctionNodeReference[]>,
): FunctionNodeReference | undefined {
  const matches = (functionNodesByFile.get(proof.targetFilePath) ?? []).filter(
    (fn) =>
      fn.name === proof.targetName &&
      fn.containerName === proof.targetOwnerName,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function isQ3ReceiverProof(
  proof: Extract<CallResolutionStrictProof, { status: "proven" }>,
): proof is Q3ReceiverProof {
  return Q3_RECEIVER_RULE_SIGNATURES.has(proof.ruleSignature);
}

function createCallSiteProof(input: {
  result: ParsedAstFileResult;
  callSite: CallSiteShape;
  callSiteKey: string;
  sourceHash: string;
  sourceFingerprint: string;
  sourceCandidateKey: string;
  ruleSignature: string;
  strictProof: Extract<CallResolutionStrictProof, { status: "proven" }>;
  callerFunction: FunctionNodeReference;
  targetFunction: FunctionNodeReference;
}): CallSiteProof {
  const {
    result,
    callSite,
    callSiteKey,
    sourceHash,
    sourceFingerprint,
    sourceCandidateKey,
    ruleSignature,
    strictProof,
    callerFunction,
    targetFunction,
  } = input;
  const dependencies = (
    "dependencies" in strictProof
      ? strictProof.dependencies
      : [{ filePath: result.file, contentHash: sourceHash }]
  )
    .slice()
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  const dependencyFingerprint = sha256(JSON.stringify(dependencies));
  const evidenceJson = JSON.stringify({
    kind: strictProof.reason,
    sourceFingerprint,
    sourceCandidateKey,
  });
  const resolution: CallSiteResolutionRecord = {
    callSiteKey,
    identityVersion: 1,
    filePath: result.file,
    sourceContentHash: sourceHash,
    startLine: callSite.startLine,
    startColumn: callSite.startColumn,
    calleeKind: callSite.calleeKind,
    calleeName: callSite.calleeName,
    callerNodeKey: callerFunction.nodeKey,
    resolutionClass: CallSiteResolutionClasses.PROVEN,
    selectedTargetNodeKey: targetFunction.nodeKey,
    confidence: null,
    resolver: "strict-proof",
    ruleSignature,
    dependencyFingerprint,
    dependencies,
    verificationStatus: CallSiteVerificationStatuses.UNVERIFIED,
    verifiedTargetNodeKey: null,
    isStale: false,
    candidates: [
      { targetNodeKey: targetFunction.nodeKey, ordinal: 0, evidenceJson },
    ],
  };
  const strictObservation: CallSiteResolutionObservationInput = {
    callSiteKey,
    filePath: result.file,
    sourceContentHash: sourceHash,
    source: CallSiteResolutionObservationSources.STRICT_PROOF,
    targetNodeKey: targetFunction.nodeKey,
    evidenceJson,
    resolutionClass: CallSiteResolutionClasses.PROVEN,
    resolver: "strict-proof",
    ruleSignature,
  };
  return { callSiteKey, resolution, strictObservation };
}

function proofForCall(
  service: ICallResolutionHypothesisService,
  workspaceIndex: CallResolutionHypothesisWorkspaceIndex,
  result: ParsedAstFileResult,
  functionNodes: readonly FunctionNodeReference[],
  functionNodesByFile: ReadonlyMap<string, readonly FunctionNodeReference[]>,
  call: ParsedCall,
): CallSiteProof | undefined {
  const callSite = uniqueCallSiteShape(call, result);
  if (!callSite) return undefined;

  const sourceHash = sourceContentHashForProof(result);
  const hypothesis = service.hypothesize({
    callerFilePath: result.file,
    callerSourceContentHash: sourceHash,
    callSite,
    workspaceIndex,
  });
  const { strictProof } = hypothesis;
  if (strictProof.status !== "proven") return undefined;

  const targetFunction = isQ3ReceiverProof(strictProof)
    ? q3TargetFunction(strictProof, functionNodesByFile)
    : strictProof.ruleSignature === "q1:named-import:v1" ||
        strictProof.ruleSignature === CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE
      ? namedImportTargetFunction(strictProof, functionNodesByFile)
      : strictTargetFunction(result, strictProof.targetKey, functionNodes);
  const callerFunction = callerNodeForCall(
    result,
    call,
    callSite,
    functionNodes,
  );
  if (!targetFunction || !callerFunction) return undefined;

  return createCallSiteProof({
    result,
    callSite,
    callSiteKey: portableCallSiteKey(result.file, sourceHash, callSite),
    sourceHash,
    sourceFingerprint: hypothesis.sourceFingerprint,
    sourceCandidateKey: strictProof.targetKey,
    ruleSignature: strictProof.ruleSignature,
    strictProof,
    callerFunction,
    targetFunction,
  });
}

export function collectStrictCallSiteProofs(input: {
  service: ICallResolutionHypothesisService;
  workspaceIndex: CallResolutionHypothesisWorkspaceIndex;
  result: ParsedAstFileResult;
  functionNodes: readonly FunctionNodeReference[];
  functionNodesByFile: ReadonlyMap<string, readonly FunctionNodeReference[]>;
}): CallSiteProof[] {
  const proofs: CallSiteProof[] = [];
  for (const call of input.result.data.calls ?? []) {
    const proof = proofForCall(
      input.service,
      input.workspaceIndex,
      input.result,
      input.functionNodes,
      input.functionNodesByFile,
      call,
    );
    if (proof) proofs.push(proof);
  }
  return proofs;
}
