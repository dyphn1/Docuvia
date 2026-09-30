import { createHash } from "node:crypto";
import {
  DocuviaError,
  ErrorCodes,
  SemanticDecisionOptionKinds,
  SemanticDecisionSchemaVersion,
  SemanticDecisionTasks,
  type SemanticDecisionOption,
  type SemanticDecisionRequest,
} from "@workspace/contracts";
import {
  SYSTEM1_BYTE_LIMITS,
  SYSTEM1_CALLER_ID_LIMIT,
  SYSTEM1_CANDIDATE_LIMIT,
  SYSTEM1_FEATURE_SCHEMA_VERSION,
  SYSTEM1_LIMIT_ERROR_MESSAGE,
  SYSTEM1_OPTION_IDS,
  SYSTEM1_OPTION_TEXT,
  SYSTEM1_REQUEST_ID_PREFIX,
  SYSTEM1_RESERVED_CANDIDATE_ID_ERROR,
  SYSTEM1_SAMPLE_ID_LIMIT,
  SYSTEM1_SOURCE,
} from "./system1-constants.js";
import type {
  System1CandidateInput,
  System1StateInput,
} from "./system1-types.js";

interface BoundedText {
  readonly text: string;
  readonly truncated: boolean;
}

interface EncodedContext {
  readonly text: string;
  readonly truncated: boolean;
}

function boundUtf8(text: string, maxBytes: number): BoundedText {
  let output = "";
  let usedBytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (usedBytes + size > maxBytes) return { text: output, truncated: true };
    output += character;
    usedBytes += size;
  }
  return { text: output, truncated: false };
}

function assertIdentifierBytes(value: string, maxBytes: number): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes)
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
      SYSTEM1_LIMIT_ERROR_MESSAGE,
    );
}

function validateIdentity(input: System1StateInput): void {
  for (const value of [
    input.repoId,
    input.worktreeId,
    input.projectId,
    input.snapshotHash,
  ])
    assertIdentifierBytes(value, SYSTEM1_CALLER_ID_LIMIT);
  assertIdentifierBytes(input.sampleId, SYSTEM1_SAMPLE_ID_LIMIT);
}

function boundedCandidate(candidate: System1CandidateInput): {
  readonly option: SemanticDecisionOption;
  readonly truncated: boolean;
} {
  assertIdentifierBytes(candidate.targetId, SYSTEM1_BYTE_LIMITS.TARGET_ID);
  const signature = boundUtf8(
    candidate.signatureSnippet,
    SYSTEM1_BYTE_LIMITS.CANDIDATE_SIGNATURE,
  );
  return {
    option: {
      id: candidate.id,
      kind: SemanticDecisionOptionKinds.CANDIDATE,
      text: signature.text,
      attributes: {
        targetId: candidate.targetId,
        tierARank: candidate.tierARank,
        tierAEvidence: candidate.tierAEvidence,
        evidenceStatus: candidate.evidenceStatus,
        declarationKind: candidate.declarationKind,
        overloadCount: candidate.overloadCount,
      },
    },
    truncated: signature.truncated,
  };
}

/** Tier A candidates stay in their incoming order; UNKNOWN and VERIFY are appended once. */
export function encodeSystem1Options(
  candidates: readonly System1CandidateInput[],
): readonly SemanticDecisionOption[] {
  if (candidates.length > SYSTEM1_CANDIDATE_LIMIT)
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
      SYSTEM1_LIMIT_ERROR_MESSAGE,
    );
  const encoded = candidates.map(boundedCandidate);
  const ids = encoded.map(({ option }) => option.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.includes(SYSTEM1_OPTION_IDS.UNKNOWN) ||
    ids.includes(SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP)
  )
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      SYSTEM1_RESERVED_CANDIDATE_ID_ERROR,
    );
  return [
    ...encoded.map(({ option }) => option),
    {
      id: SYSTEM1_OPTION_IDS.UNKNOWN,
      kind: SemanticDecisionOptionKinds.UNKNOWN,
      text: SYSTEM1_OPTION_TEXT.UNKNOWN,
    },
    {
      id: SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP,
      kind: SemanticDecisionOptionKinds.VERIFY,
      text: SYSTEM1_OPTION_TEXT.VERIFY_WITH_LSP,
    },
  ];
}

export function system1RequestId(sampleId: string): string {
  return `${SYSTEM1_REQUEST_ID_PREFIX}${createHash("sha256")
    .update(sampleId, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function candidateSetHash(
  candidates: readonly System1CandidateInput[],
): string {
  const evidence = candidates.map((candidate) => ({
    id: candidate.id,
    targetId: candidate.targetId,
    tierARank: candidate.tierARank,
    tierAEvidence: candidate.tierAEvidence,
    evidenceStatus: candidate.evidenceStatus,
    declarationKind: candidate.declarationKind,
    overloadCount: candidate.overloadCount,
    signatureSnippet: boundUtf8(
      candidate.signatureSnippet,
      SYSTEM1_BYTE_LIMITS.CANDIDATE_SIGNATURE,
    ).text,
  }));
  return createHash("sha256")
    .update(JSON.stringify(evidence), "utf8")
    .digest("hex");
}

function encodeContext(input: System1StateInput): EncodedContext {
  const caller = encodeCaller(input);
  const call = encodeCall(input);
  const binding = input.importBinding
    ? encodeImportBinding(input.importBinding)
    : null;
  const context = {
    caller: caller.value,
    call: call.value,
    importBinding: binding?.value ?? null,
  };
  const text = JSON.stringify(context);
  if (Buffer.byteLength(text, "utf8") > SYSTEM1_BYTE_LIMITS.CONTEXT)
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
      SYSTEM1_LIMIT_ERROR_MESSAGE,
    );
  return {
    text,
    truncated: [
      caller.truncated,
      call.truncated,
      binding?.truncated ?? false,
    ].some(Boolean),
  };
}

function encodeCaller(input: System1StateInput): {
  readonly value: { readonly filePath: string; readonly symbol: string };
  readonly truncated: boolean;
} {
  const callerFile = boundUtf8(
    input.caller.filePath,
    SYSTEM1_BYTE_LIMITS.CALLER_FILE,
  );
  const callerSymbol = boundUtf8(
    input.caller.symbol,
    SYSTEM1_BYTE_LIMITS.CALLER_SYMBOL,
  );
  return {
    value: { filePath: callerFile.text, symbol: callerSymbol.text },
    truncated: callerFile.truncated || callerSymbol.truncated,
  };
}

function encodeCall(input: System1StateInput): {
  readonly value: {
    readonly calleeName: string;
    readonly expression: string;
    readonly sourceWindow: string;
    readonly kind: System1StateInput["call"]["kind"];
    readonly receiverHint: string | null;
    readonly genericHints: readonly string[];
  };
  readonly truncated: boolean;
} {
  const calleeName = boundUtf8(
    input.call.calleeName,
    SYSTEM1_BYTE_LIMITS.CALLEE_NAME,
  );
  const expression = boundUtf8(
    input.call.expression,
    SYSTEM1_BYTE_LIMITS.CALL_EXPRESSION,
  );
  const sourceWindow = boundUtf8(
    input.call.sourceWindow,
    SYSTEM1_BYTE_LIMITS.SOURCE_WINDOW,
  );
  const receiver = input.call.receiverHint
    ? boundUtf8(input.call.receiverHint, SYSTEM1_BYTE_LIMITS.RECEIVER_HINT)
    : null;
  const genericHints = input.call.genericHints
    .slice(0, SYSTEM1_BYTE_LIMITS.MAX_GENERIC_HINTS)
    .map((hint) => boundUtf8(hint, SYSTEM1_BYTE_LIMITS.GENERIC_HINT));
  return {
    value: {
      calleeName: calleeName.text,
      expression: expression.text,
      sourceWindow: sourceWindow.text,
      kind: input.call.kind,
      receiverHint: receiver?.text ?? null,
      genericHints: genericHints.map(({ text }) => text),
    },
    truncated: [
      calleeName.truncated,
      expression.truncated,
      sourceWindow.truncated,
      input.call.sourceWindowTruncated,
      receiver?.truncated ?? false,
      genericHints.length < input.call.genericHints.length ||
        genericHints.some(({ truncated }) => truncated),
    ].some(Boolean),
  };
}

function encodeImportBinding(
  binding: NonNullable<System1StateInput["importBinding"]>,
): {
  readonly value: {
    readonly kind: string;
    readonly local: string;
    readonly imported: string;
    readonly sourceSpecifier: string;
    readonly barrelStatus: string;
    readonly pathAlias: boolean | null;
  };
  readonly truncated: boolean;
} {
  const local = boundUtf8(binding.local, SYSTEM1_BYTE_LIMITS.IMPORT_LOCAL);
  const imported = boundUtf8(
    binding.imported,
    SYSTEM1_BYTE_LIMITS.IMPORTED_NAME,
  );
  const specifier = boundUtf8(
    binding.sourceSpecifier,
    SYSTEM1_BYTE_LIMITS.IMPORT_SPECIFIER,
  );
  return {
    value: {
      kind: binding.kind,
      local: local.text,
      imported: imported.text,
      sourceSpecifier: specifier.text,
      barrelStatus: binding.barrelStatus,
      pathAlias: binding.pathAlias,
    },
    truncated: local.truncated || imported.truncated || specifier.truncated,
  };
}

function candidateSignaturesTruncated(
  candidates: readonly System1CandidateInput[],
): boolean {
  return candidates.some(
    (candidate) =>
      boundUtf8(
        candidate.signatureSnippet,
        SYSTEM1_BYTE_LIMITS.CANDIDATE_SIGNATURE,
      ).truncated,
  );
}

/** Builds a phase-0 request only from the explicitly projected, label-free state input. */
export function buildSystem1State(
  input: System1StateInput,
): SemanticDecisionRequest {
  validateIdentity(input);
  const context = encodeContext(input);
  const options = encodeSystem1Options(input.candidates);
  const truncated =
    input.candidateSetTruncated ||
    context.truncated ||
    candidateSignaturesTruncated(input.candidates);
  const request: SemanticDecisionRequest = {
    schemaVersion: SemanticDecisionSchemaVersion,
    requestId: system1RequestId(input.sampleId),
    featureSchemaVersion: SYSTEM1_FEATURE_SCHEMA_VERSION,
    evidence: {
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      projectId: input.projectId,
      snapshotHash: input.snapshotHash,
      candidateSetHash: candidateSetHash(input.candidates),
      truncated,
    },
    task: SemanticDecisionTasks.EDGE_RELATION,
    language: SYSTEM1_SOURCE.LANGUAGE,
    relation: SYSTEM1_SOURCE.RELATION,
    context: { text: context.text },
    options,
  };
  assertRequestSize(request);
  return request;
}

function assertRequestSize(request: SemanticDecisionRequest): void {
  if (
    Buffer.byteLength(JSON.stringify(request), "utf8") >
    SYSTEM1_BYTE_LIMITS.REQUEST
  )
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
      SYSTEM1_LIMIT_ERROR_MESSAGE,
    );
}

function textWasTruncated(value: string, limit: number): boolean {
  return boundUtf8(value, limit).truncated;
}

/** Mirrors every text cap so report counts describe clipped text, not candidate-set truncation. */
export function system1TextWasTruncated(input: System1StateInput): boolean {
  const flags = [
    textWasTruncated(input.caller.filePath, SYSTEM1_BYTE_LIMITS.CALLER_FILE),
    textWasTruncated(input.caller.symbol, SYSTEM1_BYTE_LIMITS.CALLER_SYMBOL),
    textWasTruncated(input.call.calleeName, SYSTEM1_BYTE_LIMITS.CALLEE_NAME),
    textWasTruncated(
      input.call.expression,
      SYSTEM1_BYTE_LIMITS.CALL_EXPRESSION,
    ),
    textWasTruncated(
      input.call.sourceWindow,
      SYSTEM1_BYTE_LIMITS.SOURCE_WINDOW,
    ),
    input.call.sourceWindowTruncated,
    Boolean(
      input.call.receiverHint &&
      textWasTruncated(
        input.call.receiverHint,
        SYSTEM1_BYTE_LIMITS.RECEIVER_HINT,
      ),
    ),
    input.call.genericHints.length > SYSTEM1_BYTE_LIMITS.MAX_GENERIC_HINTS,
    input.call.genericHints.some((hint) =>
      textWasTruncated(hint, SYSTEM1_BYTE_LIMITS.GENERIC_HINT),
    ),
    Boolean(
      input.importBinding &&
      (textWasTruncated(
        input.importBinding.local,
        SYSTEM1_BYTE_LIMITS.IMPORT_LOCAL,
      ) ||
        textWasTruncated(
          input.importBinding.imported,
          SYSTEM1_BYTE_LIMITS.IMPORTED_NAME,
        ) ||
        textWasTruncated(
          input.importBinding.sourceSpecifier,
          SYSTEM1_BYTE_LIMITS.IMPORT_SPECIFIER,
        )),
    ),
    candidateSignaturesTruncated(input.candidates),
  ];
  return flags.some(Boolean);
}
