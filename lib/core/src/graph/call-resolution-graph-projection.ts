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
  /** Transient local id; omitted from portable proof records and offline parity fixtures. */
  readonly graphNodeId?: number;
  readonly name: string;
  readonly containerName?: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly declarationSpan?: { readonly start: number; readonly end: number };
  readonly declarationTargetKeys: readonly string[];
};

export type StrictCallProofExclusion = {
  readonly callSiteKey: string;
  readonly filePath: string;
  readonly ruleSignature: string;
  readonly reason:
    "target-declaration-node-unmatched" | "ambiguous-target-declaration-node";
  readonly count: 1;
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

/** Construct a graph reference that binds the AST function span to its proof declaration key. */
export function createFunctionNodeReference(
  result: ParsedAstFileResult,
  fn: NonNullable<ParsedAstFileResult["data"]["functions"]>[number],
  nodeKey: string,
  graphNodeId?: number,
): FunctionNodeReference {
  const span = fn.declarationSpan;
  const declarationTargetKeys = span
    ? (result.data.declaredTypeFacts?.declarations ?? [])
        .filter(
          (declaration) =>
            declaration.declarationSpan.start === span.start &&
            declaration.declarationSpan.end === span.end,
        )
        .map((declaration) =>
          candidateTargetKeyForDeclaration(result.file, declaration),
        )
        .filter((key): key is string => key !== undefined)
    : [];
  return {
    nodeKey,
    ...(graphNodeId !== undefined ? { graphNodeId } : {}),
    name: fn.name,
    containerName: fn.containerName,
    startLine: fn.startLine,
    endLine: fn.endLine,
    ...(span ? { declarationSpan: span } : {}),
    declarationTargetKeys: [...new Set(declarationTargetKeys)],
  };
}

type TargetFunctionMatch =
  | { readonly functionNode: FunctionNodeReference }
  | {
      readonly exclusionReason: StrictCallProofExclusion["reason"];
    };

function functionNodeForTargetKey(input: {
  targetKey: string;
  functionNodes: readonly FunctionNodeReference[];
  targetName?: string;
  targetOwnerName?: string;
}): TargetFunctionMatch {
  const matches = input.functionNodes.filter(
    (fn) =>
      fn.declarationTargetKeys.includes(input.targetKey) &&
      (input.targetName === undefined || fn.name === input.targetName) &&
      (input.targetOwnerName === undefined ||
        fn.containerName === input.targetOwnerName),
  );
  if (matches.length === 1) {
    const [functionNode] = matches;
    if (functionNode) return { functionNode };
  }
  return {
    exclusionReason:
      matches.length === 0
        ? "target-declaration-node-unmatched"
        : "ambiguous-target-declaration-node",
  };
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

function strictTargetDeclarations(
  result: ParsedAstFileResult,
  targetKey: string,
) {
  const matches = (result.data.declaredTypeFacts?.declarations ?? []).filter(
    (declaration) =>
      candidateTargetKeyForDeclaration(result.file, declaration) === targetKey,
  );
  if (
    matches.length === 0 ||
    matches.some(
      (declaration) =>
        declaration.kind !== "method" ||
        declaration.owner.kind !== "class" ||
        !declaration.owner.name ||
        !declaration.name ||
        declaration.isStatic,
    )
  ) {
    return undefined;
  }
  const first = matches[0];
  if (
    !first ||
    matches.some(
      (declaration) =>
        declaration.name !== first.name ||
        declaration.owner.name !== first.owner.name,
    )
  )
    return undefined;
  return matches;
}

function strictTargetFunction(
  result: ParsedAstFileResult,
  targetKey: string,
  functionNodes: readonly FunctionNodeReference[],
): TargetFunctionMatch {
  const declarations = strictTargetDeclarations(result, targetKey);
  const declaration = declarations?.[0];
  if (!declaration?.name || !declaration.owner.name)
    return { exclusionReason: "target-declaration-node-unmatched" };
  return functionNodeForTargetKey({
    targetKey,
    functionNodes,
    targetName: declaration.name,
    targetOwnerName: declaration.owner.name,
  });
}

function fileNodeForCall(
  result: ParsedAstFileResult,
  call: ParsedCall,
): FunctionNodeReference {
  return {
    nodeKey: result.file,
    name: result.file,
    startLine: call.startLine,
    endLine: call.startLine,
    declarationTargetKeys: [],
  };
}

/**
 * Selects the unique innermost graph function containing this call. Legacy source-function
 * hints are deliberately ignored: callbacks and arrows can be nested inside a wider function
 * while carrying the outer name (or a parameter name) in the parsed call record. Equal-span
 * ties and calls outside function bodies fall back to the file node, matching #573.
 */
export function exactCallerNodeForCall(
  result: ParsedAstFileResult,
  call: ParsedCall,
  functionNodes: readonly FunctionNodeReference[],
): FunctionNodeReference {
  if (!Number.isSafeInteger(call.startLine) || call.startLine < 0) {
    return fileNodeForCall(result, call);
  }

  const enclosingFunctions = functionNodes.filter(
    (fn) =>
      Number.isSafeInteger(fn.startLine) &&
      Number.isSafeInteger(fn.endLine) &&
      fn.startLine <= call.startLine &&
      fn.endLine >= call.startLine,
  );
  if (enclosingFunctions.length > 0) {
    const smallestSpan = Math.min(
      ...enclosingFunctions.map((fn) => fn.endLine - fn.startLine),
    );
    const innermostFunctions = enclosingFunctions.filter(
      (fn) => fn.endLine - fn.startLine === smallestSpan,
    );
    if (innermostFunctions.length !== 1) return fileNodeForCall(result, call);
    const [innermostFunction] = innermostFunctions;
    if (innermostFunction) return innermostFunction;
  }
  return fileNodeForCall(result, call);
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
): TargetFunctionMatch {
  return functionNodeForTargetKey({
    targetKey: proof.targetKey,
    functionNodes: functionNodesByFile.get(proof.targetFilePath) ?? [],
    targetName: proof.targetName,
  });
}

function q3TargetFunction(
  proof: Q3ReceiverProof,
  functionNodesByFile: ReadonlyMap<string, readonly FunctionNodeReference[]>,
): TargetFunctionMatch {
  return functionNodeForTargetKey({
    targetKey: proof.targetKey,
    functionNodes: functionNodesByFile.get(proof.targetFilePath) ?? [],
    targetName: proof.targetName,
    targetOwnerName: proof.targetOwnerName,
  });
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
): {
  readonly proof?: CallSiteProof;
  readonly exclusion?: StrictCallProofExclusion;
} {
  const callSite = uniqueCallSiteShape(call, result);
  if (!callSite) return {};

  const sourceHash = sourceContentHashForProof(result);
  const hypothesis = service.hypothesize({
    callerFilePath: result.file,
    callerSourceContentHash: sourceHash,
    callSite,
    workspaceIndex,
  });
  const { strictProof } = hypothesis;
  if (strictProof.status !== "proven") return {};

  const targetMatch = isQ3ReceiverProof(strictProof)
    ? q3TargetFunction(strictProof, functionNodesByFile)
    : strictProof.ruleSignature === "q1:named-import:v1" ||
        strictProof.ruleSignature === CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE
      ? namedImportTargetFunction(strictProof, functionNodesByFile)
      : strictTargetFunction(result, strictProof.targetKey, functionNodes);
  if (!("functionNode" in targetMatch)) {
    return {
      exclusion: {
        callSiteKey: portableCallSiteKey(result.file, sourceHash, callSite),
        filePath: result.file,
        ruleSignature: strictProof.ruleSignature,
        reason: targetMatch.exclusionReason,
        count: 1,
      },
    };
  }
  const callerFunction = exactCallerNodeForCall(result, call, functionNodes);

  return {
    proof: createCallSiteProof({
      result,
      callSite,
      callSiteKey: portableCallSiteKey(result.file, sourceHash, callSite),
      sourceHash,
      sourceFingerprint: hypothesis.sourceFingerprint,
      sourceCandidateKey: strictProof.targetKey,
      ruleSignature: strictProof.ruleSignature,
      strictProof,
      callerFunction,
      targetFunction: targetMatch.functionNode,
    }),
  };
}

export function collectStrictCallSiteProofs(input: {
  service: ICallResolutionHypothesisService;
  workspaceIndex: CallResolutionHypothesisWorkspaceIndex;
  result: ParsedAstFileResult;
  functionNodes: readonly FunctionNodeReference[];
  functionNodesByFile: ReadonlyMap<string, readonly FunctionNodeReference[]>;
}): {
  readonly proofs: readonly CallSiteProof[];
  readonly exclusions: readonly StrictCallProofExclusion[];
} {
  const proofs: CallSiteProof[] = [];
  const exclusions: StrictCallProofExclusion[] = [];
  for (const call of input.result.data.calls ?? []) {
    const outcome = proofForCall(
      input.service,
      input.workspaceIndex,
      input.result,
      input.functionNodes,
      input.functionNodesByFile,
      call,
    );
    if (outcome.proof) proofs.push(outcome.proof);
    if (outcome.exclusion) exclusions.push(outcome.exclusion);
  }
  return { proofs, exclusions };
}
