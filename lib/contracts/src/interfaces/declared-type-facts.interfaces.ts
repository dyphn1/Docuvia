/** Versioned, source-only facts extracted from TypeScript/JavaScript syntax. */
export const AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION = 1 as const;
export const AST_Q3_RECEIVER_FACTS_SCHEMA_VERSION = 1 as const;

export type AstDeclaredTypeLanguage = "typescript" | "tsx" | "javascript";

/** Offsets count UTF-16 code units, matching JavaScript string indices. */
export interface AstUtf16Span {
  readonly start: number;
  readonly end: number;
}

export type AstDeclaredTypeOwnerKind =
  "program" | "class" | "interface" | "object" | "function" | "method";

export interface AstDeclaredTypeOwner {
  readonly kind: AstDeclaredTypeOwnerKind;
  readonly name: string | null;
  readonly span: AstUtf16Span;
  /** Names declared by this owner's own generic parameter list, never inferred. */
  readonly genericTypeParameterNames: readonly string[];
}

export type AstDeclaredTypeFactKind =
  | "field-annotation"
  | "parameter-annotation"
  | "parameter-property"
  | "variable-annotation"
  | "new-initializer"
  | "return-annotation"
  | "implements"
  | "extends";

/**
 * One explicit, simple named-type relation in source. This is syntax evidence, not a resolved
 * symbol: `typeName` can still be shadowed or invisible and must be resolved by a later phase.
 */
export interface AstDeclaredTypeFact {
  readonly kind: AstDeclaredTypeFactKind;
  readonly name: string | null;
  readonly typeName: string;
  readonly typeText: string;
  readonly declarationSpan: AstUtf16Span;
  readonly typeSpan: AstUtf16Span;
  readonly owner: AstDeclaredTypeOwner;
  readonly lexicalScopeSpan: AstUtf16Span;
}

export type AstDeclaredVisibility = "public" | "protected" | "private";

export interface AstDeclaredCallableArity {
  /** Minimum argument count implied by non-optional positional parameters. */
  readonly requiredParameterCount: number;
  /** Maximum positional count, or null when a rest parameter accepts more arguments. */
  readonly maxParameterCount: number | null;
}

export type AstDeclaredDeclarationKind =
  | "field"
  | "method"
  | "constructor"
  | "getter"
  | "setter"
  | "function"
  | "arrow"
  | "function-expression"
  | "unknown";

export type AstDeclaredUnsupportedReason =
  "computed-name" | "unsupported-member" | "syntax-error";

/**
 * Syntactic member/callable inventory kept separate from typed facts. Untyped JavaScript
 * declarations still appear here, so candidate completeness and arity never depend on a type
 * annotation being supported.
 */
export interface AstDeclaredDeclaration {
  readonly kind: AstDeclaredDeclarationKind;
  readonly name: string | null;
  readonly declarationSpan: AstUtf16Span;
  readonly owner: AstDeclaredTypeOwner;
  readonly lexicalScopeSpan: AstUtf16Span;
  readonly visibility: AstDeclaredVisibility | null;
  readonly isStatic: boolean;
  readonly isAbstract: boolean;
  readonly isOptional: boolean;
  readonly arity: AstDeclaredCallableArity | null;
  /** Generic parameters on this callable, separate from its class/interface owner. */
  readonly genericTypeParameterNames: readonly string[];
  readonly unsupportedReason?: AstDeclaredUnsupportedReason;
}

/** A candidate set is complete only when all of its direct members were understood. */
export interface AstDeclaredOwnerInventory {
  readonly owner: AstDeclaredTypeOwner;
  readonly complete: boolean;
  readonly incompleteReasons: readonly AstDeclaredUnsupportedReason[];
}

export interface AstDeclaredTypeFacts {
  readonly schemaVersion: typeof AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION;
  readonly language: AstDeclaredTypeLanguage;
  readonly facts: readonly AstDeclaredTypeFact[];
  readonly declarations: readonly AstDeclaredDeclaration[];
  readonly ownerInventories: readonly AstDeclaredOwnerInventory[];
  /** Proof-only additions are versioned separately and ignored by candidate ranking. */
  readonly q3ReceiverFacts?: AstQ3ReceiverFacts;
}

/** A simple, syntax-only type alias relation used only by strict Q3 proofs. */
export interface AstQ3TypeAliasFact {
  readonly name: string;
  readonly typeName: string;
  readonly declarationSpan: AstUtf16Span;
  readonly typeSpan: AstUtf16Span;
  readonly owner: AstDeclaredTypeOwner;
  readonly scopeSpan: AstUtf16Span;
  readonly genericTypeParameterNames: readonly string[];
  readonly isExported: boolean;
}

export interface AstQ3ClassDeclarationFact {
  readonly kind: "class" | "interface";
  readonly name: string;
  readonly declarationSpan: AstUtf16Span;
  readonly scopeSpan: AstUtf16Span;
  readonly genericTypeParameterNames: readonly string[];
}

/** A `new C()` local binding with its declaration kind and source-local writes. */
export interface AstQ3NewReceiverBindingFact {
  readonly name: string;
  readonly typeName: string;
  readonly declarationSpan: AstUtf16Span;
  readonly scopeSpan: AstUtf16Span;
  readonly bindingKind: "const" | "let" | "var";
  readonly isReassigned: boolean;
}

/** Additive proof-only syntax facts; never used to rank or calibrate candidates. */
export interface AstQ3ReceiverFacts {
  readonly schemaVersion: typeof AST_Q3_RECEIVER_FACTS_SCHEMA_VERSION;
  readonly classes: readonly AstQ3ClassDeclarationFact[];
  readonly typeAliases: readonly AstQ3TypeAliasFact[];
  readonly newReceiverBindings: readonly AstQ3NewReceiverBindingFact[];
}
