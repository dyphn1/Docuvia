import type { AstUtf16Span } from "./declared-type-facts.interfaces.js";

export const AST_CALL_SITE_SHAPE_SCHEMA_VERSION = 2 as const;

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

export type AstCallCalleeBinding =
  | {
      readonly kind:
        "import" | "type-only-import" | "local" | "parameter" | "unsupported";
      readonly name: string;
      readonly declarationSpan: AstUtf16Span;
      readonly scopeSpan: AstUtf16Span;
    }
  | { readonly kind: "unbound"; readonly name: string };

export interface AstCallSiteShapeFact {
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeName: string;
  readonly calleeKind: "bare" | "member" | "this" | "arg-chain";
  readonly receiverText: string | null;
  readonly receiverBinding: AstCallReceiverBinding | null;
  /** True when optional chaining appears in the callee expression; absent in older facts. */
  readonly receiverOptional?: boolean;
  /** Exact syntax-scope binding for bare calls; only `import` enables alias enrichment. */
  readonly calleeBinding: AstCallCalleeBinding | null;
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
