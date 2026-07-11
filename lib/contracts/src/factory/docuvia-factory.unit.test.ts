import { describe, it, expect, beforeEach } from "vitest";
import { DocuviaFactory } from "./docuvia-factory.js";
import { ErrorCodes } from "../errors/error-codes.js";

const TOKEN = Symbol("ITestThing") as any;
const DEP_TOKEN = Symbol("IDependency") as any;

describe("DocuviaFactory", () => {
  let factory: DocuviaFactory;

  beforeEach(() => {
    factory = new DocuviaFactory();
  });

  it("resolve() returns a brand-new instance on every call (transient by default)", () => {
    factory.register(TOKEN, () => ({}));

    const a = factory.resolve(TOKEN);
    const b = factory.resolve(TOKEN);

    expect(a).not.toBe(b);
  });

  it("resolve() throws FACTORY_TOKEN_NOT_REGISTERED for an unregistered token", () => {
    expect(() => factory.resolve(TOKEN)).toThrowError(
      expect.objectContaining({ code: ErrorCodes.FACTORY_TOKEN_NOT_REGISTERED })
    );
  });

  it("a provider can resolve its own nested dependencies from the same factory", () => {
    factory.register(DEP_TOKEN, () => "dependency-value");
    factory.register(TOKEN, (f) => ({ dep: f.resolve(DEP_TOKEN) }));

    expect(factory.resolve<{ dep: string }>(TOKEN)).toEqual({ dep: "dependency-value" });
  });

  it("passes per-call params through to the provider without going through the registry", () => {
    factory.register<{ logger?: string }, { logger?: string }>(TOKEN, (_f, params) => params);

    expect(factory.resolve(TOKEN, { logger: "injected" })).toEqual({ logger: "injected" });
  });

  it("lock() prevents further registrations, throwing FACTORY_LOCKED", () => {
    factory.lock();

    expect(() => factory.register(TOKEN, () => ({}))).toThrowError(
      expect.objectContaining({ code: ErrorCodes.FACTORY_LOCKED })
    );
  });

  it("unlock() re-allows registration after a lock()", () => {
    factory.lock();
    factory.unlock();

    expect(() => factory.register(TOKEN, () => ({}))).not.toThrow();
  });

  it("reset() clears every registration and unlocks", () => {
    factory.register(TOKEN, () => ({}));
    factory.lock();

    factory.reset();

    expect(factory.has(TOKEN)).toBe(false);
    expect(() => factory.register(TOKEN, () => ({}))).not.toThrow();
  });

  it("has() reflects registration state", () => {
    expect(factory.has(TOKEN)).toBe(false);
    factory.register(TOKEN, () => ({}));
    expect(factory.has(TOKEN)).toBe(true);
  });
});
