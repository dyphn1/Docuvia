import { describe, it, expect, beforeEach } from "vitest";
import { AstParseCache } from "./ast-parse-cache.js";
import { AstParseResponse } from "../../workers/ast-worker.js";

describe("AstParseCache", () => {
  let cache: AstParseCache;

  beforeEach(() => {
    cache = new AstParseCache(10 * 1024 * 1024, 60 * 1000); // 10MB, 60s TTL for testing
  });

  it("should track cache hits", () => {
    const contentHash = "test-hash-1";
    const response: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
      },
    };

    cache.set(contentHash, response);
    const result = cache.get(contentHash);

    expect(result).toEqual(response);
    expect(cache.metrics.hits).toBe(1);
    expect(cache.metrics.misses).toBe(0);
  });

  it("should track cache misses", () => {
    const result = cache.get("non-existent-hash");

    expect(result).toBeUndefined();
    expect(cache.metrics.hits).toBe(0);
    expect(cache.metrics.misses).toBe(1);
  });

  it("should track metrics correctly", () => {
    const response: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
      },
    };

    cache.set("hash-1", response);
    cache.get("hash-1"); // hit
    cache.get("hash-2"); // miss
    cache.get("hash-1"); // hit
    cache.get("hash-3"); // miss

    const metrics = cache.metrics;
    expect(metrics.hits).toBe(2);
    expect(metrics.misses).toBe(2);
  });

  it("should clear cache and reset metrics", () => {
    const response: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
      },
    };

    cache.set("hash-1", response);
    cache.get("hash-1");

    cache.clear();

    const result = cache.get("hash-1");
    expect(result).toBeUndefined();
    expect(cache.metrics.hits).toBe(0);
    expect(cache.metrics.misses).toBe(1); // One miss from the get after clear
  });

  it("should handle LRU eviction when maxSize exceeded", async () => {
    // Create a small cache (10KB total) - definitely too small for multiple items
    const smallCache = new AstParseCache(10 * 1024, 60 * 1000); // 10KB

    const largeResponse: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: Array(200).fill({ localName: "test", originalName: "test", modulePath: "test" }),
        exports: Array(200).fill({ name: "test", type: "function" as const }),
        functions: Array(200).fill({ name: "test", startLine: 1, endLine: 10 }),
        classes: [],
        calls: [],
      },
    };

    // Add items until eviction should definitely occur
    // Each response serializes to ~15-20KB, so with 10KB cache, we'll definitely have evictions
    for (let i = 0; i < 3; i++) {
      smallCache.set(`hash-${i}`, largeResponse);
    }

    // With 10KB cache and ~15-20KB items, multiple items should have been evicted
    expect(smallCache.metrics.evictions).toBeGreaterThan(0);

    // Verify that we can still access at least one recent item (LRU should keep recent items)
    // The newest item should still exist
    const newestItemExists = smallCache.get("hash-2") !== undefined;
    expect(newestItemExists).toBe(true);

    // Verify cache still functions and has content
    expect(smallCache.metrics.hits + smallCache.metrics.misses).toBeGreaterThan(0);
  });

  it("should return a copy of metrics", () => {
    const response: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
      },
    };

    cache.set("hash-1", response);
    cache.get("hash-1");

    const metrics1 = cache.metrics;
    const metrics2 = cache.metrics;

    // Verify they're equal but independent objects
    expect(metrics1).toEqual(metrics2);
    expect(metrics1).not.toBe(metrics2);
  });

  it("should handle concurrent access safely", async () => {
    const response: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
      },
    };

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        Promise.resolve().then(() => {
          cache.set(`hash-${i}`, response);
          return cache.get(`hash-${i}`);
        })
      );
    }

    const results = await Promise.all(promises);
    const successfulGets = results.filter((r) => r !== undefined).length;

    expect(successfulGets).toBe(10);
    expect(cache.metrics.hits).toBeGreaterThanOrEqual(10);
  });
});
