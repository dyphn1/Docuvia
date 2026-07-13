import { DocuviaError } from "../errors/docuvia-error.js";
import { ErrorCodes } from "../errors/error-codes.js";

/**
 * UUID-scoped runtime configuration store — see
 * docs/gitbook/architecture/application-lifecycle-and-state.md. The *only* source of truth
 * for runtime configuration (workspace paths, log level, feature flags, ...). Implementation
 * libraries read exclusively from here (never `process.env`); the Presentation layer creates a
 * scope per invocation and is responsible for deleting it when the run completes (Garbage
 * Collection), preventing OOM leaks in long-running hosts like an MCP server.
 */
export class DocuviaMemory {
  private readonly scopes = new Map<string, Map<string, unknown>>();

  /** Creates an empty scope for `scopeId` (no-op if it already exists). */
  createScope(scopeId: string): void {
    if (!this.scopes.has(scopeId)) this.scopes.set(scopeId, new Map());
  }

  set<T>(scopeId: string, key: string, value: T): void {
    const scope = this.scopes.get(scopeId);
    if (!scope) {
      throw new DocuviaError(
        ErrorCodes.MEMORY_SCOPE_NOT_FOUND,
        `Cannot set "${key}": memory scope "${scopeId}" was never created`,
      );
    }
    scope.set(key, value);
  }

  get<T>(scopeId: string, key: string): T | undefined {
    return this.scopes.get(scopeId)?.get(key) as T | undefined;
  }

  /** Deletes the entire scope. Must be called by the Presentation layer once a run is complete. */
  deleteScope(scopeId: string): void {
    this.scopes.delete(scopeId);
  }

  hasScope(scopeId: string): boolean {
    return this.scopes.has(scopeId);
  }
}

export const docuviaMemory = new DocuviaMemory();
