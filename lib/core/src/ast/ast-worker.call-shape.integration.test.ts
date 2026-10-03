import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  type AstCallSiteShapeFacts,
} from "@workspace/contracts";
import { AstWorkerPool } from "./ast-worker-pool.js";
import type { AstParseResponse } from "./ast-worker.js";

function parseData(response: AstParseResponse) {
  if (!response.success || !response.data)
    throw new Error(response.error ?? "AST worker returned no parse data");
  return response.data;
}

describe("AST worker call-shape facts", () => {
  it("[happy] extracts argument and receiver-binding facts from real call syntax", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "fixture.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: [
          "class Client {",
          "  constructor(private readonly service: Service) {}",
          "  run(value: string) {",
          '    this.service.open("outer");',
          "    this.service.close();",
          "    function nested(service: Service) { service.open(true); }",
          "  }",
          "}",
        ].join("\n"),
      });

      expect(response.success).toBe(true);
      const data = parseData(response);
      const shapes = data.callSiteShapeFacts;
      expect(data.calls).toHaveLength(3);
      expect(
        data.calls.map(({ targetFunction, startLine }) => [
          targetFunction,
          startLine,
        ]),
      ).toEqual([
        ["this.service.open", 3],
        ["this.service.close", 4],
        ["service.open", 5],
      ]);
      expect(shapes).toMatchObject({
        schemaVersion: 1,
        language: "typescript",
        callSites: expect.arrayContaining([
          expect.objectContaining({
            calleeName: "open",
            receiverText: "this.service",
            argumentCount: 1,
            argumentKinds: ["string"],
          }),
          expect.objectContaining({
            calleeName: "close",
            receiverText: "this.service",
            argumentCount: 0,
            argumentKinds: [],
          }),
          expect.objectContaining({
            calleeName: "open",
            receiverText: "service",
            argumentCount: 1,
            argumentKinds: ["boolean"],
          }),
        ]),
      });

      const openCalls = shapes?.callSites.filter(
        (call) => call.calleeName === "open",
      );
      expect(openCalls).toHaveLength(2);
      expect(openCalls?.[0]?.receiverBinding).not.toEqual(
        openCalls?.[1]?.receiverBinding,
      );
      expect(openCalls?.[0]?.peerMemberNames).toContain("close");
      expect(openCalls?.[1]?.peerMemberNames).not.toContain("close");
    } finally {
      await pool.terminate();
    }
  });

  it("[invalid-input] leaves spread-call arity unknown while retaining known literal kinds", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "spread.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "function invoke(service: Service, args: string[]) { service.run(1, ...args); }",
      });

      expect(response.success).toBe(true);
      const [call] = parseData(response).callSiteShapeFacts?.callSites ?? [];
      expect(call).toMatchObject({
        calleeName: "run",
        argumentCount: null,
        hasSpreadArgument: true,
        argumentKinds: ["number", "unknown"],
      });
    } finally {
      await pool.terminate();
    }
  });

  it("[error-handling] recovers after a malformed request and parses the next callsite", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const failure = await pool.parse({
        filePath: null as unknown as string,
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "function broken() {}",
      });
      expect(failure.success).toBe(false);

      const recovered = await pool.parse({
        filePath: "recovered.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "function run(service: Service) { service.close(); }",
      });
      expect(parseData(recovered).callSiteShapeFacts?.callSites).toMatchObject([
        { calleeName: "close", argumentCount: 0 },
      ]);
    } finally {
      await pool.terminate();
    }
  });

  it("[stress] returns identical call-shape facts over repeated worker parses", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const request = {
        filePath: "repeat.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: 'function run(service: Service) { service.open("x"); service.close(); }',
      };
      const outputs: Array<AstCallSiteShapeFacts | undefined> = [];
      for (let index = 0; index < 25; index += 1) {
        const response = await pool.parse(request);
        outputs.push(parseData(response).callSiteShapeFacts);
      }
      expect(outputs).toEqual(Array.from({ length: 25 }, () => outputs[0]));
    } finally {
      await pool.terminate();
    }
  });

  it("[state-diff] changing and restoring a callsite changes and restores its shape", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const original = await pool.parse({
        filePath: "state.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "function run(service: Service) { service.open(); }",
      });
      const changed = await pool.parse({
        filePath: "state.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "function run(service: Service) { service.close(1); }",
      });
      const restored = await pool.parse({
        filePath: "state.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "function run(service: Service) { service.open(); }",
      });

      const originalFacts = parseData(original).callSiteShapeFacts;
      const changedFacts = parseData(changed).callSiteShapeFacts;
      expect(changedFacts).not.toEqual(originalFacts);
      expect(parseData(restored).callSiteShapeFacts).toEqual(originalFacts);
    } finally {
      await pool.terminate();
    }
  });
});
