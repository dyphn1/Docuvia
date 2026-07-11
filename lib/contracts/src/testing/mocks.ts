import { Logger } from "../logging/logger.js";
import type { ILogger, LogEvent } from "../logging/types.js";
import { docuviaFactory } from "../factory/docuvia-factory.js";

export interface MockLogger extends ILogger {
  /** Every event emitted so far, in order — for test assertions. */
  readonly events: LogEvent[];
}

/** A logger that records every emitted event instead of routing it anywhere. */
export function createMockLogger(): MockLogger {
  const events: LogEvent[] = [];
  const logger = new Logger();
  logger.onLog((event) => events.push(event));
  return Object.assign(logger, { events });
}

/**
 * Test isolation helper — see docs/gitbook/architecture/testing-and-quality-architecture.md's
 * "Factory Lock". Clears every registration (undoing any implementation-library import side
 * effects a prior test left behind) and unlocks the factory so the test can register its own
 * mock providers. Call in `beforeEach`, register mocks, then call `docuviaFactory.lock()` once
 * setup is complete so a stray real-implementation import can't silently overwrite a mock
 * mid-test — it will throw `FACTORY_LOCKED` instead.
 */
export function resetFactoryForTests(): void {
  docuviaFactory.reset();
}
