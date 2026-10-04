/** Versioned, source-only facts extracted from TypeScript/JavaScript syntax. */
export const AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION = 1 as const;

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
}
