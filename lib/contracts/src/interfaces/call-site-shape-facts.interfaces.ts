import type { AstUtf16Span } from "./declared-type-facts.interfaces.js";

export const AST_CALL_SITE_SHAPE_SCHEMA_VERSION = 1 as const;

export type AstCallArgumentKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array"
  | "function"
  | "unknown";

export type AstCallReceiverBindingKind =
  "parameter" | "local" | "parameter-property" | "field" | "this";

/** A syntax-only binding identity. Receiver text alone is never sufficient to join peer calls. */
export interface AstCallReceiverBinding {
  readonly kind: AstCallReceiverBindingKind;
  readonly name: string;
  readonly declarationSpan: AstUtf16Span;
  readonly scopeSpan: AstUtf16Span;
}

export interface AstCallSiteShapeFact {
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeName: string;
  readonly calleeKind: "bare" | "member" | "this" | "arg-chain";
  readonly receiverText: string | null;
  readonly receiverBinding: AstCallReceiverBinding | null;
  readonly lexicalScopeSpan: AstUtf16Span;
  readonly callerType: {
    readonly name: string;
    readonly span: AstUtf16Span;
  } | null;
  /** Null when a spread argument makes positional arity unknown. */
  readonly argumentCount: number | null;
  readonly hasSpreadArgument: boolean;
  readonly argumentKinds: readonly AstCallArgumentKind[];
  /** Other calls on the identical receiver binding in this exact lexical scope. */
  readonly peerMemberNames: readonly string[];
}

export interface AstCallSiteShapeFacts {
  readonly schemaVersion: typeof AST_CALL_SITE_SHAPE_SCHEMA_VERSION;
  readonly language: "typescript" | "tsx" | "javascript";
  readonly callSites: readonly AstCallSiteShapeFact[];
}
