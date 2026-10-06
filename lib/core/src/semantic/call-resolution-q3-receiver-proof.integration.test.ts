import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "@workspace/contracts";
import { AstWorkerPool } from "../ast/ast-worker-pool.js";
import type { AstParseResponse } from "../ast/ast-worker.js";
import { CallResolutionHypothesisService } from "./call-resolution-hypothesis.service.js";
import { collectStrictCallSiteProofs } from "../graph/call-resolution-graph-projection.js";
import type { FunctionNodeReference } from "../graph/call-resolution-graph-projection.js";

// [happy] [invalid-input] [error-handling] [stress] [state-diff]
interface SourceInput {
  readonly filePath: string;
  readonly code: string;
}

type ParsedSource = SourceInput & {
  readonly data: ReturnType<typeof parseData>;
};

let pool: AstWorkerPool;

beforeAll(async () => {
  pool = new AstWorkerPool();
  await pool.initialize(1);
});

afterAll(async () => {
  await pool.terminate();
});

function parseData(response: AstParseResponse) {
  if (!response.success || !response.data)
    throw new Error(response.error ?? "AST worker returned no parse data");
  return response.data;
}

function sha256(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

async function parseFile(file: SourceInput) {
  return parseData(
    await pool.parse({
      filePath: file.filePath,
      language: file.filePath.endsWith(".js")
        ? SUPPORTED_LANGUAGES.JAVASCRIPT
        : SUPPORTED_LANGUAGES.TYPESCRIPT,
      code: file.code,
    }),
  );
}

async function resolveCall(
  files: readonly SourceInput[],
  calleeName = "m",
  includeUnindexedWorkspaceFile = false,
) {
  const parsedFiles: ParsedSource[] = await Promise.all(
    files.map(async (file) => ({ ...file, data: await parseFile(file) })),
  );
  const caller = parsedFiles.find(
    ({ filePath }) =>
      filePath.endsWith("/caller.ts") || filePath.endsWith("/caller.js"),
  );
  const callSites = caller?.data.callSiteShapeFacts?.callSites ?? [];
  const matchingSites = callSites.filter(
    (callSite) => callSite.calleeName === calleeName,
  );
  if (!caller || matchingSites.length !== 1 || !matchingSites[0])
    throw new Error(`Expected one ${calleeName} call site in caller`);

  const service = new CallResolutionHypothesisService();
  const workspaceIndex = service.indexWorkspace({
    sourceFingerprint: "f".repeat(64),
    sourceIndexComplete: true,
    sourceFiles: [
      ...parsedFiles.map(({ filePath, code, data }) => ({
        filePath,
        sourceContentHash: sha256(code),
        imports: data.imports,
        exports: data.exports,
        reexports: data.reexports,
        callSiteShapeFacts: data.callSiteShapeFacts,
        declaredTypeFacts: data.declaredTypeFacts ?? null,
      })),
      ...(includeUnindexedWorkspaceFile
        ? [
            {
              filePath: "src/unrelated.ts",
              sourceContentHash: "e".repeat(64),
              imports: [],
              exports: [],
              reexports: [],
              callSiteShapeFacts: null,
              declaredTypeFacts: null,
            },
          ]
        : []),
    ],
  });
  const result = service.hypothesize({
    callerFilePath: caller.filePath,
    callerSourceContentHash: sha256(caller.code),
    callSite: matchingSites[0],
    workspaceIndex,
  });
  return {
    result,
    callSite: matchingSites[0],
    parsedFiles,
    service,
    workspaceIndex,
  };
}

function expectProven(
  result: Awaited<ReturnType<typeof resolveCall>>["result"],
  signature: string,
  targetFilePath: string,
  dependencyPaths: readonly string[],
): void {
  const proof = result.strictProof;
  if (proof.status !== "proven")
    throw new Error(
      `Expected a source-bound Q3 proof, got ${JSON.stringify(proof)}`,
    );
  expect(proof.status).toEqual("proven");
  expect(proof.ruleSignature).toEqual(signature);
  if (proof.status !== "proven" || !("targetFilePath" in proof))
    throw new Error("Expected a source-bound Q3 proof");
  expect(proof.targetFilePath).toEqual(targetFilePath);
  expect(proof.dependencies.map(({ filePath }) => filePath).sort()).toEqual(
    [...dependencyPaths].sort(),
  );
}

function expectAbstained(
  result: Awaited<ReturnType<typeof resolveCall>>["result"],
): void {
  expect(result.strictProof.status).toEqual("abstained");
}

describe("Q3 receiver strict proofs", () => {
  it("[happy] proves super.m from one direct concrete base declaration", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Base } from './base.js'; class Child extends Base { run() { super.m(); } }",
    };
    const base = {
      filePath: "src/base.ts",
      code: "export class Base { m(): void {} }",
    };
    const { result, parsedFiles } = await resolveCall([caller, base]);
    expect(parsedFiles[1]?.data.exports).toEqual([
      { name: "Base", type: "class" },
    ]);
    expectProven(result, "q3:super-call:v1", "src/base.ts", [
      "src/base.ts",
      "src/caller.ts",
    ]);
  });

  it("[happy] proves this.m through a unique extends chain", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Middle } from './middle.js'; class Child extends Middle { run() { this.m(); } }",
    };
    const middle = {
      filePath: "src/middle.ts",
      code: "import { Base } from './base.js'; export class Middle extends Base {}",
    };
    const base = {
      filePath: "src/base.ts",
      code: "export class Base { m(): void {} }",
    };
    const { result } = await resolveCall([caller, middle, base]);

    expectProven(result, "q3:this-inherited:v1", "src/base.ts", [
      "src/base.ts",
      "src/caller.ts",
      "src/middle.ts",
    ]);
  });

  it("[happy] proves a typed parameter through one named class import", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Service } from './service.js'; function run(service: Service) { service.m(); }",
    };
    const service = {
      filePath: "src/service.ts",
      code: "export class Service { m(): void {} }",
    };
    const { result } = await resolveCall([caller, service]);

    expectProven(result, "q3:typed-receiver:v1", "src/service.ts", [
      "src/caller.ts",
      "src/service.ts",
    ]);
  });

  it("[happy] proves a typed class field receiver", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Service } from './service.js'; class Client { service: Service; run() { this.service.m(); } }",
    };
    const service = {
      filePath: "src/service.ts",
      code: "export class Service { m(): void {} }",
    };
    const { result } = await resolveCall([caller, service]);

    expectProven(result, "q3:typed-receiver:v1", "src/service.ts", [
      "src/caller.ts",
      "src/service.ts",
    ]);
  });

  it("[happy] proves a typed constructor parameter property receiver", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Service } from './service.js'; class Client { constructor(public service: Service) {} run() { this.service.m(); } }",
    };
    const service = {
      filePath: "src/service.ts",
      code: "export class Service { m(): void {} }",
    };
    const { result } = await resolveCall([caller, service]);

    expectProven(result, "q3:typed-receiver:v1", "src/service.ts", [
      "src/caller.ts",
      "src/service.ts",
    ]);
  });

  it("[happy] proves a type alias that resolves to one imported class", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import type { ServiceAlias } from './types.js'; function run(service: ServiceAlias) { service.m(); }",
    };
    const types = {
      filePath: "src/types.ts",
      code: "import type { Service } from './service.js'; export type ServiceAlias = Service;",
    };
    const service = {
      filePath: "src/service.ts",
      code: "export class Service { m(): void {} }",
    };
    const { result } = await resolveCall([caller, types, service]);

    expectProven(result, "q3:typed-receiver:v1", "src/service.ts", [
      "src/caller.ts",
      "src/service.ts",
      "src/types.ts",
    ]);
  });

  it("[happy] proves new C().m() in TypeScript", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } new Service().m();",
    };
    const { result } = await resolveCall([caller]);

    expectProven(result, "q3:new-receiver:v1", "src/caller.ts", [
      "src/caller.ts",
    ]);
  });

  it("[happy] proves a const initialized by new when the binding is unchanged", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } const service = new Service(); service.m();",
    };
    const { result } = await resolveCall([caller]);

    expectProven(result, "q3:new-receiver:v1", "src/caller.ts", [
      "src/caller.ts",
    ]);
  });

  it("[happy] proves JavaScript class/new syntax without JSDoc", async () => {
    const caller = {
      filePath: "src/caller.js",
      code: "class Service { m() {} } new Service().m();",
    };
    const { result } = await resolveCall([caller]);

    expectProven(result, "q3:new-receiver:v1", "src/caller.js", [
      "src/caller.js",
    ]);
  });

  it("[happy] proves a local receiver despite unrelated missing workspace facts", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } new Service().m();",
    };
    const { result } = await resolveCall([caller], "m", true);

    expectProven(result, "q3:new-receiver:v1", "src/caller.ts", [
      "src/caller.ts",
    ]);
  });

  it("[invalid-input] abstains when the imported receiver type is ambiguous", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Service } from './one.js'; import { Service } from './two.js'; function run(service: Service) { service.m(); }",
    };
    const one = {
      filePath: "src/one.ts",
      code: "export class Service { m(): void {} }",
    };
    const two = {
      filePath: "src/two.ts",
      code: "export class Service { m(): void {} }",
    };
    const { result } = await resolveCall([caller, one, two]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains when a type name has no same-file or import binding", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "function run(logger: Logger) { logger.close(); }",
    };
    const unimportedClass = {
      filePath: "src/logger.ts",
      code: "export class Logger { close(): void {} }",
    };
    const { result } = await resolveCall([caller, unimportedClass], "close");

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "unresolved-type-binding",
    });
  });

  it("[invalid-input] abstains when a type alias resolves to an interface", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "interface LoggerPort { close(): void } type LoggerAlias = LoggerPort; function run(logger: LoggerAlias) { logger.close(); }",
    };
    const { result } = await resolveCall([caller], "close");

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "unresolved-type-binding",
    });
  });

  it("[invalid-input] abstains on an overloaded typed receiver member", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void; m(value: number): void; m(value?: number): void {} } function run(service: Service) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains on an abstract typed receiver member", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "abstract class Service { abstract m(): void; } function run(service: Service) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains when the receiver annotation is a union", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } class Other { m(): void {} } function run(service: Service | Other) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains when the receiver annotation is an intersection", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } interface Contract {} function run(service: Service & Contract) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains when the receiver annotation is generic", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } function run<T extends Service>(service: T) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains when a type alias resolves to a union", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } class Other { m(): void {} } type Receiver = Service | Other; function run(service: Receiver) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains when a typed receiver names an interface", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "interface Service { m(): void } function run(service: Service) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains on optional chaining", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } function run(service: Service) { service?.m(); }",
    };
    const { result, callSite } = await resolveCall([caller]);

    expect(callSite.receiverOptional).toEqual(true);
    expectAbstained(result);
  });

  it("[invalid-input] abstains when a new-initialized local is reassigned", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } let service = new Service(); service = new Service(); service.m();",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains when a const new-initialized local has a write", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Service { m(): void {} } const service = new Service(); service = new Service(); service.m();",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains on an abstract super member", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "abstract class Base { abstract m(): void; } class Child extends Base { run() { super.m(); } }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains on overloaded super members", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Base { m(): void; m(value: number): void; m(value?: number): void {} } class Child extends Base { run() { super.m(); } }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] does not skip an abstract shadow to prove an older base member", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Base { m(): void {} } abstract class Middle extends Base { abstract m(): void; } class Child extends Middle { run() { this.m(); } }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[invalid-input] abstains on a mixin expression in extends", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "class Base { m(): void {} } function mixin<T extends new (...args: never[]) => object>(base: T) { return base; } class Child extends mixin(Base) { run() { this.m(); } }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[error-handling] abstains when the type import leaves the workspace", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Service } from '../outside.js'; function run(service: Service) { service.m(); }",
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[stress] proves an inherited member at depth 16", async () => {
    const chain = Array.from({ length: 16 }, (_, index) => {
      const name = `Layer${index}`;
      const parent = index === 15 ? "" : ` extends Layer${index + 1}`;
      const member = index === 15 ? " m(): void {}" : "";
      return `class ${name}${parent} {${member}}`;
    });
    const caller = {
      filePath: "src/caller.ts",
      code: `${chain.join(" ")} class Child extends Layer0 { run() { this.m(); } }`,
    };
    const { result } = await resolveCall([caller]);

    expectProven(result, "q3:this-inherited:v1", "src/caller.ts", [
      "src/caller.ts",
    ]);
  });

  it("[stress] abstains when the inherited member is beyond depth 16", async () => {
    const chain = Array.from({ length: 17 }, (_, index) => {
      const name = `Layer${index}`;
      const parent = index === 16 ? "" : ` extends Layer${index + 1}`;
      const member = index === 16 ? " m(): void {}" : "";
      return `class ${name}${parent} {${member}}`;
    });
    const caller = {
      filePath: "src/caller.ts",
      code: `${chain.join(" ")} class Child extends Layer0 { run() { this.m(); } }`,
    };
    const { result } = await resolveCall([caller]);

    expectAbstained(result);
  });

  it("[state-diff] drops a proof when an inherited declaration changes", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: "import { Base } from './base.js'; class Child extends Base { run() { this.m(); } }",
    };
    const originalBase = {
      filePath: "src/base.ts",
      code: "export class Base { m(): void {} }",
    };
    const changedBase = {
      filePath: "src/base.ts",
      code: "export class Base { renamed(): void {} }",
    };
    const before = await resolveCall([caller, originalBase]);
    const after = await resolveCall([caller, changedBase]);

    expectProven(before.result, "q3:this-inherited:v1", "src/base.ts", [
      "src/base.ts",
      "src/caller.ts",
    ]);
    expectAbstained(after.result);
  });

  it("[state-diff] preserves the callback's caller span while proving its typed receiver", async () => {
    const caller = {
      filePath: "src/caller.ts",
      code: [
        "import { Service } from './service.js';",
        "function run() {",
        "  [1].forEach((service: Service) => {",
        "    service.m();",
        "  });",
        "}",
      ].join("\n"),
    };
    const serviceFile = {
      filePath: "src/service.ts",
      code: "export class Service { m(): void {} }",
    };
    const { result, callSite, parsedFiles, service, workspaceIndex } =
      await resolveCall([caller, serviceFile]);

    expectProven(result, "q3:typed-receiver:v1", "src/service.ts", [
      "src/caller.ts",
      "src/service.ts",
    ]);
    expect(callSite.lexicalScopeSpan.start).toEqual(
      callSite.receiverBinding?.scopeSpan.start,
    );
    const parsedCaller = parsedFiles.find(({ filePath }) =>
      filePath.endsWith("/caller.ts"),
    );
    if (!parsedCaller) throw new Error("Expected parsed caller source");
    const functionNodesByFile = new Map<
      string,
      readonly FunctionNodeReference[]
    >(
      parsedFiles.map(({ filePath, data }) => [
        filePath,
        data.functions.map((fn) => ({
          nodeKey: `${filePath}#${fn.containerName ?? ""}.${fn.name}`,
          name: fn.name,
          containerName: fn.containerName,
          startLine: fn.startLine,
          endLine: fn.endLine,
        })),
      ]),
    );
    const projected = collectStrictCallSiteProofs({
      service,
      workspaceIndex,
      result: {
        file: parsedCaller.filePath,
        hash: sha256(parsedCaller.code),
        data: parsedCaller.data,
      },
      functionNodes: functionNodesByFile.get(parsedCaller.filePath) ?? [],
      functionNodesByFile,
    });
    expect(projected).toHaveLength(1);
    expect(projected[0]?.resolution.callerNodeKey).toEqual(
      "src/caller.ts#.anonymous",
    );
    expect(projected[0]?.resolution.selectedTargetNodeKey).toEqual(
      "src/service.ts#Service.m",
    );
  });
});
