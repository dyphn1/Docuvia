import { describe, it, expect, beforeEach } from "vitest";
import { DocuviaMemory, MemoryKeys } from "./docuvia-memory.js";
import { ErrorCodes } from "../errors/error-codes.js";

describe("DocuviaMemory", () => {
  let memory: DocuviaMemory;

  beforeEach(() => {
    memory = new DocuviaMemory();
  });

  it("set()/get() round-trip within a created scope", () => {
    memory.createScope("scope-1");
    memory.set("scope-1", MemoryKeys.WORKSPACE_ROOT, "/tmp/repo");

    expect(memory.get("scope-1", MemoryKeys.WORKSPACE_ROOT)).toBe("/tmp/repo");
  });

  it("get() returns undefined for a key that was never set", () => {
    memory.createScope("scope-1");
    expect(memory.get("scope-1", MemoryKeys.COMMIT_SHA)).toBe(undefined);
  });

  it("createScope() is idempotent — calling it twice does not wipe existing values", () => {
    memory.createScope("scope-1");
    memory.set("scope-1", MemoryKeys.API_URL, "value");
    memory.createScope("scope-1");

    expect(memory.get("scope-1", MemoryKeys.API_URL)).toBe("value");
  });

  it("scopes are isolated from each other", () => {
    memory.createScope("scope-a");
    memory.createScope("scope-b");
    memory.set("scope-a", MemoryKeys.API_URL, "a-value");
    memory.set("scope-b", MemoryKeys.API_URL, "b-value");

    expect(memory.get("scope-a", MemoryKeys.API_URL)).toBe("a-value");
    expect(memory.get("scope-b", MemoryKeys.API_URL)).toBe("b-value");
  });

  it("round-trips the boolean analyze flags with their concrete values (issue #231)", () => {
    memory.createScope("scope-1");
    memory.set("scope-1", MemoryKeys.FORCE, true);
    memory.set("scope-1", MemoryKeys.TIER_C_DRAIN_ALL, true);
    memory.set("scope-1", MemoryKeys.ESCALATE_TO_LSP, false);

    expect(memory.get("scope-1", MemoryKeys.FORCE)).toBe(true);
    expect(memory.get("scope-1", MemoryKeys.TIER_C_DRAIN_ALL)).toBe(true);
    expect(memory.get("scope-1", MemoryKeys.ESCALATE_TO_LSP)).toBe(false);
  });

  it("set() throws MEMORY_SCOPE_NOT_FOUND when the scope was never created", () => {
    expect(() =>
      memory.set("never-created", MemoryKeys.API_URL, "value"),
    ).toThrowError(
      expect.objectContaining({ code: ErrorCodes.MEMORY_SCOPE_NOT_FOUND }),
    );
  });

  it("deleteScope() removes all values for that scope (garbage collection)", () => {
    memory.createScope("scope-1");
    memory.set("scope-1", MemoryKeys.API_URL, "value");

    memory.deleteScope("scope-1");

    expect(memory.hasScope("scope-1")).toBe(false);
    expect(memory.get("scope-1", MemoryKeys.API_URL)).toBe(undefined);
  });

  it("hasScope() reflects scope lifecycle", () => {
    expect(memory.hasScope("scope-1")).toBe(false);
    memory.createScope("scope-1");
    expect(memory.hasScope("scope-1")).toBe(true);
    memory.deleteScope("scope-1");
    expect(memory.hasScope("scope-1")).toBe(false);
  });
});
