import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "@workspace/contracts";
import { AstWorkerPool } from "./ast-worker-pool.js";
import type { AstParseResponse } from "./ast-worker.js";

function parseData(response: AstParseResponse) {
  if (!response.success || !response.data)
    throw new Error(response.error ?? "AST worker returned no parse data");
  return response.data;
}

describe("AST worker declared type facts", () => {
  it("[happy] adds syntax facts while preserving the existing AST projection", async () => {
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
      const firstData = parseData(first);
      const secondData = parseData(second);
      expect(firstData).toEqual(secondData);
      expect(firstData).toMatchObject({
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

  it("[invalid-input] omits facts for malformed type declarations", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "fixture.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "class Broken { service: ; }",
      });

      expect(response.success).toBe(true);
      expect(parseData(response).declaredTypeFacts).toMatchObject({
        schemaVersion: 1,
        language: "typescript",
        facts: [],
      });
    } finally {
      await pool.terminate();
    }
  });

  it("[error-handling] reports malformed worker requests and recovers for the next file", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const failure = await pool.parse({
        filePath: null as unknown as string,
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "class Broken {}",
      });

      expect(failure).toMatchObject({
        success: false,
        error: expect.stringContaining("TypeError"),
      });

      const recovered = await pool.parse({
        filePath: "fixture.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "class Healthy { service: Service; }",
      });
      expect(recovered.success).toBe(true);
      expect(parseData(recovered).declaredTypeFacts?.facts).toContainEqual(
        expect.objectContaining({
          kind: "field-annotation",
          typeName: "Service",
        }),
      );
    } finally {
      await pool.terminate();
    }
  });

  it("[stress] returns identical parse projections over repeated jobs in one worker", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const request = {
        filePath: "fixture.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "class Client { service: Service; call(request: Request): Result {} }",
      };
      const responses: AstParseResponse[] = [];
      for (let index = 0; index < 25; index += 1)
        responses.push(await pool.parse(request));

      expect(responses.every((response) => response.success)).toBe(true);
      expect(responses.map(parseData)).toEqual(
        Array.from({ length: 25 }, () => parseData(responses[0]!)),
      );
    } finally {
      await pool.terminate();
    }
  });

  it("[state-diff] updates facts for changed source and restores the original projection", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const originalRequest = {
        filePath: "fixture.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "class Client { service: Service; }",
      };
      const changedRequest = {
        ...originalRequest,
        code: "class Client { service: Repository; }",
      };
      const original = await pool.parse(originalRequest);
      const changed = await pool.parse(changedRequest);
      const restored = await pool.parse(originalRequest);

      expect(original.success).toBe(true);
      expect(changed.success).toBe(true);
      expect(restored.success).toBe(true);
      expect(
        parseData(original).declaredTypeFacts?.facts.map(
          (fact) => fact.typeName,
        ),
      ).toEqual(["Service"]);
      expect(
        parseData(changed).declaredTypeFacts?.facts.map(
          (fact) => fact.typeName,
        ),
      ).toEqual(["Repository"]);
      expect(parseData(restored)).toEqual(parseData(original));
    } finally {
      await pool.terminate();
    }
  });
});
