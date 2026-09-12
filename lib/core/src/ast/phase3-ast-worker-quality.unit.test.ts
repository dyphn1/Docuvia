import { afterEach, describe, expect, it } from "vitest";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { AstWorkerPool } from "./ast-worker-pool.js";

// TDD-SOURCE: lib/contracts/src/interfaces/ast.interfaces.ts
// TDD-SOURCE: issue #371 Phase 3 / issue #380

describe("Phase 3 AST worker quality", () => {
  let pool: AstWorkerPool | undefined;

  afterEach(async () => {
    if (pool) {
      await pool.terminate();
      pool = undefined;
    }
  });

  it(
    "returns identical parsed AST data for repeated identical input",
    async () => {
      pool = new AstWorkerPool();
      await pool.initialize(1);

      const request = {
        filePath: "deterministic.ts",
        code: [
          "export function helper(value: number) {",
          "  return value + 1;",
          "}",
          "export function caller() {",
          "  return helper(41);",
          "}",
        ].join("\n"),
        language: "typescript",
      };

      const first = await pool.parse(request);
      const second = await pool.parse(request);

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.data).toEqual(first.data);
      expect(first.data?.functions.map((item) => item.name)).toEqual([
        "helper",
        "caller",
      ]);
      expect(first.data?.calls).toContainEqual(
        expect.objectContaining({
          sourceFunction: "caller",
          targetFunction: "helper",
        }),
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
