import { describe, it, expect, beforeEach } from "vitest";
import { DocuviaMemory } from "./docuvia-memory.js";
import { ErrorCodes } from "../errors/error-codes.js";

describe("DocuviaMemory", () => {
  let memory: DocuviaMemory;

  beforeEach(() => {
    memory = new DocuviaMemory();
  });

  it("set()/get() round-trip within a created scope", () => {
    memory.createScope("scope-1");
    memory.set("scope-1", "workspaceRoot", "/tmp/repo");

    expect(memory.get("scope-1", "workspaceRoot")).toBe("/tmp/repo");
  });

  it("get() returns undefined for a key that was never set", () => {
    memory.createScope("scope-1");
    expect(memory.get("scope-1", "commitSha")).toBeUndefined();
  });

  it("createScope() is idempotent — calling it twice does not wipe existing values", () => {
    memory.createScope("scope-1");
    memory.set("scope-1", "apiUrl", "value");
    memory.createScope("scope-1");

    expect(memory.get("scope-1", "apiUrl")).toBe("value");
  });

  it("scopes are isolated from each other", () => {
    memory.createScope("scope-a");
    memory.createScope("scope-b");
    memory.set("scope-a", "apiUrl", "a-value");
    memory.set("scope-b", "apiUrl", "b-value");

    expect(memory.get("scope-a", "apiUrl")).toBe("a-value");
    expect(memory.get("scope-b", "apiUrl")).toBe("b-value");
  });

  it("set() throws MEMORY_SCOPE_NOT_FOUND when the scope was never created", () => {
    expect(() => memory.set("never-created", "apiUrl", "value")).toThrowError(
      expect.objectContaining({ code: ErrorCodes.MEMORY_SCOPE_NOT_FOUND }),
    );
  });

  it("deleteScope() removes all values for that scope (garbage collection)", () => {
    memory.createScope("scope-1");
    memory.set("scope-1", "apiUrl", "value");

    memory.deleteScope("scope-1");

    expect(memory.hasScope("scope-1")).toBe(false);
    expect(memory.get("scope-1", "apiUrl")).toBeUndefined();
  });

  it("hasScope() reflects scope lifecycle", () => {
    expect(memory.hasScope("scope-1")).toBe(false);
    memory.createScope("scope-1");
    expect(memory.hasScope("scope-1")).toBe(true);
    memory.deleteScope("scope-1");
    expect(memory.hasScope("scope-1")).toBe(false);
  });
});
