import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "@workspace/contracts";
import { AstWorkerPool } from "./ast-worker-pool.js";

describe("AST worker declared type facts", () => {
  it("adds deterministic syntax facts while preserving the existing AST projection", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const request = {
        filePath: "fixture.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: [
          "class Client { service: Request; request(input: Request): Response {} }",
          "function caller(client: Client, input: Request) { client.request(input); }",
        ].join("\n"),
      };
      const first = await pool.parse(request);
      const second = await pool.parse(request);

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(first.data).toEqual(second.data);
      expect(first.data).toMatchObject({
        imports: [],
        exports: [],
        variables: [],
        classes: [expect.objectContaining({ name: "Client" })],
        functions: expect.arrayContaining([
          expect.objectContaining({ name: "request", containerName: "Client" }),
          expect.objectContaining({ name: "caller" }),
        ]),
        calls: [
          expect.objectContaining({
            sourceFunction: "caller",
            targetFunction: "client.request",
            calleeName: "request",
            calleeKind: "member",
          }),
        ],
        implements: [],
        extends: [],
        workerSpawns: [],
        declaredTypeFacts: {
          schemaVersion: 1,
          language: "typescript",
          facts: expect.arrayContaining([
            expect.objectContaining({
              kind: "field-annotation",
              typeName: "Request",
            }),
            expect.objectContaining({
              kind: "return-annotation",
              typeName: "Response",
            }),
            expect.objectContaining({
              kind: "parameter-annotation",
              typeName: "Client",
            }),
          ]),
        },
      });
    } finally {
      await pool.terminate();
    }
  });
});
