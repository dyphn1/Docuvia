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
        schemaVersion: 2,
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

  it("[invalid-input] distinguishes import aliases from type-only and lexical shadows", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "callee-bindings.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: [
          'import { close as finish } from "./service.js";',
          'import type { close as TypeFinish } from "./types.js";',
          'import { type close as InlineTypeFinish } from "./types.js";',
          "finish();",
          "TypeFinish();",
          "InlineTypeFinish();",
          "function withParameter(TypeFinish: () => void) { TypeFinish(); }",
          "function withLocal() { const finish = () => {}; finish(); }",
        ].join("\n"),
      });

      const data = parseData(response);
      expect(data.imports).toEqual([
        {
          localName: "finish",
          originalName: "close",
          modulePath: "./service.js",
        },
        {
          localName: "TypeFinish",
          originalName: "close",
          modulePath: "./types.js",
          isTypeOnly: true,
        },
        {
          localName: "InlineTypeFinish",
          originalName: "close",
          modulePath: "./types.js",
          isTypeOnly: true,
        },
      ]);
      expect(
        data.callSiteShapeFacts?.callSites.map(
          ({ calleeName, calleeBinding }) => [calleeName, calleeBinding?.kind],
        ),
      ).toEqual([
        ["finish", "import"],
        ["TypeFinish", "type-only-import"],
        ["InlineTypeFinish", "type-only-import"],
        ["TypeFinish", "parameter"],
        ["finish", "local"],
      ]);
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

  it("[invalid-input] ignores comments when counting call arguments", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "comments.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: "function run(service: Service) { service.open(/* note */); }",
      });

      expect(parseData(response).callSiteShapeFacts?.callSites).toMatchObject([
        { calleeName: "open", argumentCount: 0, argumentKinds: [] },
      ]);
    } finally {
      await pool.terminate();
    }
  });

  it("[error-handling] abstains for unsupported catch, loop, and destructuring shadows", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "shadowing.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: [
          "function run(service: Service, input: any, items: Service[]) {",
          "  try {} catch (service) { service.run(); }",
          "  for (const service of items) { service.run(); }",
          "  service.run();",
          "  { const { service } = input; service.run(); }",
          "}",
        ].join("\n"),
      });

      const calls = parseData(response).callSiteShapeFacts?.callSites ?? [];
      expect(calls).toHaveLength(4);
      expect(calls[0]?.receiverBinding).toBeNull();
      expect(calls[1]?.receiverBinding).toBeNull();
      expect(calls[2]?.receiverBinding).toMatchObject({ kind: "parameter" });
      expect(calls[3]?.receiverBinding).toBeNull();
    } finally {
      await pool.terminate();
    }
  });

  it("[error-handling] keeps type signatures out of runtime bindings and stops nested this", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "scope-boundaries.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: [
          "type Callback = (service: Service) => void;",
          "service.run();",
          "class Client {",
          "  service: Service;",
          "  run() {",
          "    this.service.open();",
          "    function nested() { this.service.open(); }",
          "    const arrow = () => this.service.close();",
          "  }",
          "}",
        ].join("\n"),
      });

      const calls = parseData(response).callSiteShapeFacts?.callSites ?? [];
      expect(calls).toHaveLength(4);
      expect(calls[0]?.receiverBinding).toBeNull();
      expect(calls[1]?.receiverBinding).toMatchObject({ kind: "field" });
      expect(calls[2]?.receiverBinding).toBeNull();
      expect(calls[3]?.receiverBinding).toMatchObject({ kind: "field" });
      expect(calls[2]?.callerType).toBeNull();
    } finally {
      await pool.terminate();
    }
  });

  it("[happy] indexes readonly constructor parameter properties as class members", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const response = await pool.parse({
        filePath: "readonly-property.ts",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: [
          "class Client {",
          "  constructor(readonly service: Service) {}",
          "  run() { this.service.open(); }",
          "}",
          "class NotAProperty {",
          "  constructor(service: { readonly value: string }) {}",
          "  run() { this.service.open(); }",
          "}",
        ].join("\n"),
      });

      expect(parseData(response).callSiteShapeFacts?.callSites).toMatchObject([
        { receiverBinding: { kind: "parameter-property", name: "service" } },
        { receiverBinding: null },
      ]);
    } finally {
      await pool.terminate();
    }
  });

  it("[invalid-input] treats untyped parameters and declarations as shadows", async () => {
    const pool = new AstWorkerPool();
    await pool.initialize(1);
    try {
      const tsxResponse = await pool.parse({
        filePath: "typed-outer-shadow.tsx",
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
        code: [
          "function outer() {",
          "  const service: Service = create();",
          "  service.outer();",
          "  function nested(service) { service.inner(); }",
          "  const arrow = service => service.arrow();",
          "  { function service() {} service.calledFromFunctionBlock(); }",
          "  { class service {} service.calledFromClassBlock(); }",
          "  service.after();",
          "}",
        ].join("\n"),
      });
      const tsxCalls =
        parseData(tsxResponse).callSiteShapeFacts?.callSites ?? [];
      expect(tsxCalls.map((call) => call.calleeName)).toEqual([
        "create",
        "outer",
        "inner",
        "arrow",
        "calledFromFunctionBlock",
        "calledFromClassBlock",
        "after",
      ]);
      const outerLocal = tsxCalls[1]!.receiverBinding;
      const nestedParameter = tsxCalls[2]!.receiverBinding;
      const arrowParameter = tsxCalls[3]!.receiverBinding;
      expect(outerLocal).toMatchObject({ kind: "local" });
      expect(nestedParameter).toMatchObject({ kind: "parameter" });
      expect(arrowParameter).toMatchObject({ kind: "parameter" });
      expect(tsxCalls[4]!.receiverBinding).toBeNull();
      expect(tsxCalls[5]!.receiverBinding).toBeNull();
      expect(tsxCalls[6]!.receiverBinding).toMatchObject({ kind: "local" });
      expect(nestedParameter).not.toEqual(outerLocal);
      expect(arrowParameter).not.toEqual(outerLocal);

      const jsResponse = await pool.parse({
        filePath: "js-parameters.js",
        language: SUPPORTED_LANGUAGES.JAVASCRIPT,
        code: [
          "function outer(service) {",
          "  service.outer();",
          "  function nested(service) { service.inner(); }",
          "  const arrow = service => service.arrow();",
          "}",
        ].join("\n"),
      });
      const jsCalls = parseData(jsResponse).callSiteShapeFacts?.callSites ?? [];
      const outerParameter = jsCalls[0]!.receiverBinding;
      const jsNestedParameter = jsCalls[1]!.receiverBinding;
      const jsArrowParameter = jsCalls[2]!.receiverBinding;
      expect(outerParameter).toMatchObject({ kind: "parameter" });
      expect(jsNestedParameter).toMatchObject({ kind: "parameter" });
      expect(jsArrowParameter).toMatchObject({ kind: "parameter" });
      expect(jsNestedParameter).not.toEqual(outerParameter);
      expect(jsArrowParameter).not.toEqual(outerParameter);
    } finally {
      await pool.terminate();
    }
  });
});
