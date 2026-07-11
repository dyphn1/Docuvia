import { DocuviaError } from "../errors/docuvia-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import type { Token } from "./tokens.js";

/**
 * A provider constructs a `T` given the factory itself (so it can resolve its own nested
 * dependencies by token) and optional per-call params (e.g. a request-scoped logger, which is
 * never resolved from the factory — see docs/gitbook/architecture/logging-architecture.md).
 */
export type Provider<T, P = void> = (factory: DocuviaFactory, params: P) => T;

/**
 * The only globally permitted registration factory — see
 * docs/gitbook/architecture/virtual-contracts-architecture.md#8 (Type-Safe Registry). Stores
 * *constructors*, not active instances: every `resolve()` call returns a brand-new, transient
 * instance (unless a provider deliberately closes over a shared singleton itself).
 * Implementation libraries self-register a provider as a side effect of being imported;
 * orchestration resolves by token and never imports the concrete implementation module
 * directly.
 *
 * Type safety comes entirely from `Token<T, P>` (see `tokens.ts`) being a phantom-typed
 * `symbol` — `register()`/`resolve()` infer `T`/`P` straight from whichever token value is
 * passed in, so requesting one interface through a token typed for another is a compile error,
 * with zero manual generic annotations needed at any call site.
 */
export class DocuviaFactory {
  private readonly providers = new Map<symbol, Provider<unknown, unknown>>();
  private locked = false;

  register<T, P = void>(token: Token<T, P>, provider: Provider<T, P>): void {
    if (this.locked) {
      throw new DocuviaError(
        ErrorCodes.FACTORY_LOCKED,
        `Cannot register "${String(token.description)}": factory is locked (test isolation)`
      );
    }
    this.providers.set(token, provider as Provider<unknown, unknown>);
  }

  resolve<T, P = void>(token: Token<T, P>, params?: P): T {
    const provider = this.providers.get(token);
    if (!provider) {
      throw new DocuviaError(
        ErrorCodes.FACTORY_TOKEN_NOT_REGISTERED,
        `No provider registered for "${String(token.description)}" — the implementation ` +
          `library that owns it was never imported for its registration side effect`
      );
    }
    return provider(this, params as P) as T;
  }

  has(token: symbol): boolean {
    return this.providers.has(token);
  }

  /** Test isolation: freezes registrations so a stray implementation-library import can't silently overwrite a test's mock provider mid-run. */
  lock(): void {
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
  }

  /** Test isolation: clears every registration. Callers must re-import registration side effects (or re-register mocks) afterwards. */
  reset(): void {
    this.providers.clear();
    this.locked = false;
  }
}

export const docuviaFactory = new DocuviaFactory();
