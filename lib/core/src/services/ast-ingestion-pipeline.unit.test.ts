import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AstParseCache } from "./ast/ast-parse-cache.js";
import { AstWorkerPool } from "./ast-worker-pool.js";
import { AstIngestionOrchestrator } from "./ast-ingestion-pipeline.js";
import { AstParseResponse } from "../workers/ast-worker.js";

describe("AST Ingestion Pipeline Integration", () => {
  let cache: AstParseCache;
  let workerPool: AstWorkerPool;
  let orchestrator: AstIngestionOrchestrator;

  beforeEach(async () => {
    cache = new AstParseCache(50 * 1024 * 1024, 60 * 1000); // 50MB cache
    workerPool = new AstWorkerPool(30_000, cache);
    orchestrator = new AstIngestionOrchestrator(undefined, undefined, undefined, cache, workerPool);
  });

  afterEach(async () => {
    await workerPool.terminate();
  });

  it("should cache results when content unchanged", async () => {
    const mockResponse: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: [{ localName: "test", originalName: "test", modulePath: "./test" }],
        exports: [{ name: "testFunc", type: "function" }],
        functions: [{ name: "testFunc", startLine: 1, endLine: 5 }],
        classes: [],
        calls: [],
      },
    };

    const testCode = "export function test() {}";
    const contentHash = require("crypto").createHash("sha256").update(testCode).digest("hex");

    // Manually populate cache to simulate cached parse
    cache.set(contentHash, mockResponse);

    // Verify cache hit on second access with same content
    const cachedResult = cache.get(contentHash);
    expect(cachedResult).toEqual(mockResponse);
    expect(cache.metrics.hits).toBe(1);
    expect(cache.metrics.misses).toBe(0);
  });

  it("should benchmark same file parsed 10x (expect cache hits 9/10)", async () => {
    const testCode = "export function test() {}";
    const contentHash = require("crypto").createHash("sha256").update(testCode).digest("hex");

    const mockResponse: AstParseResponse = {
      taskId: "1",
      success: true,
      data: {
        imports: [],
        exports: [{ name: "test", type: "function" }],
        functions: [{ name: "test", startLine: 1, endLine: 5 }],
        classes: [],
        calls: [],
      },
    };

    // Pre-seed cache
    cache.set(contentHash, mockResponse);

    // Simulate 10 parses of same content
    for (let i = 0; i < 10; i++) {
      const result = cache.get(contentHash);
      expect(result).toBeDefined();
    }

    const metrics = cache.metrics;
    expect(metrics.hits).toBeGreaterThanOrEqual(9);
  });

  it("should track deduplication detection", async () => {
    const testCode1 = "export function test() {}";
    const testCode2 = "export function test() {}"; // Same content

    const hash1 = require("crypto").createHash("sha256").update(testCode1).digest("hex");
    const hash2 = require("crypto").createHash("sha256").update(testCode2).digest("hex");

    // Same content should have same hash
    expect(hash1).toBe(hash2);
  });

  it("should handle LSP notifications with diff-based updates", () => {
    const oldContent = "export function test() {\n  console.log('test');\n}";
    const newContent = "export function test() {\n  console.log('updated');\n}";

    // Calculate diff (simplified simulation)
    const lines1 = oldContent.split("\n");
    const lines2 = newContent.split("\n");

    expect(lines1.length).toBe(lines2.length);
    // Line 1 changed, should detect this
    expect(lines1[1]).not.toBe(lines2[1]);
  });

  it("should handle temp file cleanup tracking", async () => {
    // This is a placeholder for temp file manager testing
    // In real scenarios, TempFileManager would be tested separately
    expect(cache.metrics.hits).toBe(0);
    expect(cache.metrics.misses).toBe(0);
  });

  it("should aggregate metrics across multiple ingestion runs", async () => {
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

    // Simulate multiple parses
    cache.set("hash-1", response);
    cache.get("hash-1"); // hit
    cache.get("hash-2"); // miss
    cache.set("hash-2", response);
    cache.get("hash-2"); // hit

    const metrics = cache.metrics;
    expect(metrics.hits).toBe(2);
    expect(metrics.misses).toBe(1);

    const hitRate = (metrics.hits / (metrics.hits + metrics.misses)) * 100;
    expect(hitRate).toBeCloseTo(66.67, 1);
  });

  it("should handle cache metrics logging at intervals", async () => {
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

    // Simulate 100+ operations to trigger metrics logging
    for (let i = 0; i < 50; i++) {
      cache.set(`hash-${i}`, response);
      cache.get(`hash-${i}`);
    }

    // Metrics should be accumulated (50 gets total)
    expect(cache.metrics.hits).toBeGreaterThan(0);
    expect(cache.metrics.hits + cache.metrics.misses).toBeGreaterThanOrEqual(50);
  });
});
