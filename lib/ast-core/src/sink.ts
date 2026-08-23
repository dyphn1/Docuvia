import { AstEventType } from "./constants/ast-event-constants.js";

// ── Per-variant shape interfaces ──────────────────────────────────────

/** Emitted once per parsed file as the first event in a generateAst() batch. */
export interface AstFileEvent {
  type: typeof AstEventType.FILE;
  path: string;
}

/** Emitted for every named class declaration discovered by tree-sitter queries. */
export interface AstClassEvent {
  type: typeof AstEventType.CLASS;
  name: string;
}

/** Emitted for every named function declaration discovered by tree-sitter queries. */
export interface AstFunctionEvent {
  type: typeof AstEventType.FUNCTION;
  name: string;
}

/** Emitted for a static (non-method) function call whose callee resolved to a fully-qualified name. */
export interface AstCallEvent {
  type: typeof AstEventType.CALL;
  name: string;
}

/** Emitted for a method call (e.g. `obj.method()`) with the receiver object name. */
export interface AstMethodCallEvent {
  type: typeof AstEventType.METHOD_CALL;
  name: string;
  method: string;
  object: string | undefined;
}

/**
 * A top-level API contract summary event — one per OpenAPI/Swagger spec file.
 * No `method` field (distinguishes it from endpoint events).
 */
export interface AstContractSummaryEvent {
  type: typeof AstEventType.API_CONTRACT;
  contractName: string;
  version: string;
  description: string;
  filePath: string;
  basePath: string;
}

/**
 * A single API endpoint event — one per (path, method) pair in an OpenAPI/Swagger spec.
 * The presence of `method` distinguishes it from the contract summary variant.
 */
export interface AstEndpointEvent {
  type: typeof AstEventType.API_CONTRACT;
  contractName: string;
  version: string;
  method: string;
  path: string;
  fullPath: string;
  summary: string;
  operationId: string | null;
  tags: string[];
  filePath: string;
  consumers: string[];
}

// ── Union ─────────────────────────────────────────────────────────────

/**
 * Strict discriminated union of all AST / ingestion-pipeline events.
 *
 * Each variant is narrowed by the `type` discriminant — no `[key: string]: any`
 * index signature, so accidental property injection is a compile-time error.
 *
 * @see ast-event-constants.ts for the discriminant values.
 */
export type AstEvent =
  | AstFileEvent
  | AstClassEvent
  | AstFunctionEvent
  | AstCallEvent
  | AstMethodCallEvent
  | AstContractSummaryEvent
  | AstEndpointEvent;

export interface AstSink {
  emit(event: AstEvent): Promise<void> | void;
  flush(): Promise<void>;
}
