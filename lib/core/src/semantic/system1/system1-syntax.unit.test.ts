import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DefaultProvider, typescriptConfig } from "@workspace/ast-core";
import { Language, Parser } from "web-tree-sitter";
import type {
  SemanticCollectionCallSite,
  SemanticCollectionGraphNode,
} from "../../../../contracts/src/index.js";
import { SYSTEM1_AMBIGUITY_CLASSES } from "./system1-constants.js";
import { classifySystem1Ambiguities } from "./system1-ambiguity-classifiers.js";
import {
  System1SnapshotSyntax,
  type System1SyntaxEnvironment,
} from "./system1-syntax.js";
import { parseSystem1ProjectOptions } from "./system1-tsconfig.js";
import { resolveWasmPath } from "../../ast/resolve-wasm-path.js";
import {
  extractTierAIndexedDeclarations,
  type TierAIndexedDeclaration,
} from "../../ast/tier-a-declaration-index.js";

let system1TestParser: Parser;
let system1TestProvider: DefaultProvider;

beforeAll(async () => {
  await Parser.init();
  const { wasmPath, attemptedPaths } = resolveWasmPath(
    typescriptConfig.wasm_file,
  );
  if (!wasmPath)
    throw new Error(
      `TypeScript grammar not found: ${attemptedPaths.join(", ")}`,
    );
  const language = await Language.load(wasmPath);
  system1TestParser = new Parser();
  system1TestParser.setLanguage(language);
  system1TestProvider = new DefaultProvider(typescriptConfig);
  system1TestProvider.initQueries?.(language);
});

afterAll(() => {
  system1TestProvider.deleteQueries?.();
  system1TestParser.delete();
});

describe("System-1 syntax projection", () => {
  it("[invalid-input] [error-handling] keeps unreadable Tier A candidates in order with explicit missing evidence", () => {
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate("tierA:first", "src/first.ts#run", "src/first.ts", "run"),
        candidate(
          "tierA:second",
          "src/missing.ts#run",
          "src/missing.ts",
          "run",
        ),
        candidate("tierA:third", "src/empty.ts#run", "src/empty.ts", "run"),
      ],
      files: {
        "src/first.ts": "export function run(): void {}",
        "src/empty.ts": "export const other = 1;",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates.map(({ id }) => id)).toEqual([
      "tierA:first",
      "tierA:second",
      "tierA:third",
    ]);
    expect(result.syntax.candidates.slice(1)).toEqual([
      {
        id: "tierA:second",
        targetId: "src/missing.ts#run",
        tierARank: 2,
        tierAEvidence: "tier-a-same-name",
        evidenceStatus: "missing",
        declarationKind: "unknown",
        signatureSnippet: "",
        overloadCount: null,
        generatedMarker: null,
        forwardingWrapper: null,
      },
      {
        id: "tierA:third",
        targetId: "src/empty.ts#run",
        tierARank: 2,
        tierAEvidence: "tier-a-same-name",
        evidenceStatus: "missing",
        declarationKind: "unknown",
        signatureSnippet: "",
        overloadCount: null,
        generatedMarker: null,
        forwardingWrapper: null,
      },
    ]);
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).notDetected,
    ).not.toContain(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS);
  });

  it("does not tag a bare Post call because a same-name candidate is decorated", () => {
    const result = buildSyntax({
      caller: `import { Injectable } from "@nestjs/common";\n@Injectable()\nclass Service {}\nfunction caller() { Post("created"); }`,
      calleeName: "Post",
      candidates: [
        candidate("tierA:post", "src/post.ts#Post", "src/post.ts", "Post"),
      ],
      files: {
        "src/post.ts": `import { ObjectType } from "type-graphql";\n@ObjectType()\nexport class Post {}`,
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.ambiguityEvidence.call.frameworkConvention).toBe(
      false,
    );
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
    ).not.toContain(SYSTEM1_AMBIGUITY_CLASSES.FRAMEWORK_CONVENTION);
  });

  it("[happy] tags calls on injected members of decorated classes", () => {
    const result = buildSyntax({
      caller: `import { Injectable } from "@nestjs/common";\n@Injectable()\nclass Worker { constructor(private readonly service: Service) {} call() { return this.service.run(); } }`,
      calleeName: "run",
      candidates: [
        candidate("tierA:run", "src/run.ts#run", "src/run.ts", "run"),
      ],
      files: { "src/run.ts": "export function run(): void {}" },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.ambiguityEvidence.call.frameworkConvention).toBe(true);
  });

  it("tags typed framework registry lookups", () => {
    const result = buildSyntax({
      caller: `import { Injectable } from "@nestjs/common";\nimport { ModuleRef } from "@nestjs/core";\n@Injectable()\nclass Worker { constructor(private readonly moduleRef: ModuleRef) {} call() { return this.moduleRef.get("SERVICE"); } }`,
      calleeName: "get",
      candidates: [
        candidate("tierA:get", "src/get.ts#get", "src/get.ts", "get"),
      ],
      files: { "src/get.ts": "export function get(): void {}" },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.ambiguityEvidence.call.frameworkConvention).toBe(true);
  });

  it("resolves this fields initialized by new, including constructor assignments", () => {
    for (const caller of [
      "class Worker { private readonly service = new Service(); call() { return this.service.run(); } }",
      "class Worker { private readonly service: Service; constructor() { this.service = new Service(); } call() { return this.service.run(); } }",
      "class Worker { private readonly service: Service; constructor(private readonly injected: Service) { this.service = this.injected as Service; } call() { return this.service.run(); } }",
    ]) {
      const result = buildSyntax({
        caller,
        calleeName: "run",
        candidates: [
          candidate("tierA:first", "src/first.ts#run", "src/first.ts", "run"),
          candidate(
            "tierA:second",
            "src/second.ts#run",
            "src/second.ts",
            "run",
          ),
        ],
        files: {
          "src/first.ts": "export function run(): void {}",
          "src/second.ts": "export function run(): void {}",
        },
      });
      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") continue;
      expect(result.syntax.call.receiverHint).toContain("Service");
      expect(result.syntax.ambiguityEvidence.call.receiverLocallyBound).toBe(
        true,
      );
      expect(
        classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
      ).not.toContain(SYSTEM1_AMBIGUITY_CLASSES.UNRESOLVED_RECEIVER_SMALL_SET);
    }
  });

  it("does not tag an untyped receiver with only one candidate", () => {
    const result = buildSyntax({
      caller: "class Worker { call() { return this.service.find(); } }",
      calleeName: "find",
      candidates: [
        candidate("tierA:find", "src/find.ts#find", "src/find.ts", "find"),
      ],
      files: { "src/find.ts": "export function find(): void {}" },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
    ).not.toContain(SYSTEM1_AMBIGUITY_CLASSES.UNRESOLVED_RECEIVER_SMALL_SET);
  });

  it("tags an untyped receiver only when the candidate set has two to four options", () => {
    const result = buildSyntax({
      caller: "class Worker { call() { return this.service.find(); } }",
      calleeName: "find",
      candidates: [
        candidate("tierA:first", "src/first.ts#find", "src/first.ts", "find"),
        candidate(
          "tierA:second",
          "src/second.ts#find",
          "src/second.ts",
          "find",
        ),
      ],
      files: {
        "src/first.ts": "export function find(): void {}",
        "src/second.ts": "export function find(): void {}",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
    ).toContain(SYSTEM1_AMBIGUITY_CLASSES.UNRESOLVED_RECEIVER_SMALL_SET);
  });

  it("describes only declarations emitted by Tier A's TypeScript extractor", () => {
    const files = {
      "src/interface.ts": "export interface Runner { run(): void; }",
      "src/model.ts": "export type Model = string;",
      "src/color.ts": "export enum Color { Red }",
      "src/namespace.ts":
        "export namespace Namespace { export function run() {} }",
    };
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate(
          "tierA:interface",
          "src/interface.ts#Runner",
          "src/interface.ts",
          "Runner",
        ),
        candidate(
          "tierA:signature",
          "src/interface.ts#run",
          "src/interface.ts",
          "run",
        ),
        candidate("tierA:type", "src/model.ts#Model", "src/model.ts", "Model"),
        candidate("tierA:enum", "src/color.ts#Color", "src/color.ts", "Color"),
        candidate(
          "tierA:module",
          "src/namespace.ts#Namespace",
          "src/namespace.ts",
          "Namespace",
        ),
      ],
      files,
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(
      result.syntax.candidates.map(({ declarationKind, evidenceStatus }) => [
        declarationKind,
        evidenceStatus,
      ]),
    ).toEqual([
      ["interface", "present"],
      ["unknown", "missing"],
      ["type-alias", "present"],
      ["enum", "present"],
      ["unknown", "missing"],
    ]);
  });

  it("does not count class-name collisions as overloads", () => {
    const result = buildSyntax({
      caller: "function caller() { Module(); }",
      calleeName: "Module",
      candidates: [
        candidate(
          "tierA:module",
          "src/modules.ts#Module",
          "src/modules.ts",
          "Module",
        ),
      ],
      files: {
        "src/modules.ts":
          "class Module {}\nfunction describeA() { class Module {} }\nfunction describeB() { class Module {} }",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      declarationKind: "class",
      evidenceStatus: "present",
      overloadCount: 1,
    });
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
    ).not.toContain(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS);
  });

  it("does not let a constructor object-literal property shadow a class method", () => {
    const result = buildSyntax({
      caller: "function caller() { transform(); }",
      calleeName: "transform",
      candidates: [
        candidate(
          "tierA:transform",
          "src/decls.ts#ParseArrayPipe.transform",
          "src/decls.ts",
          "transform",
        ),
      ],
      files: {
        "src/decls.ts": [
          "class ParseArrayPipe {",
          "  constructor() { consume({ transform: true }); }",
          "  transform(value: unknown) { return value; }",
          "}",
        ].join("\n"),
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "present",
      declarationKind: "method",
      signatureSnippet: expect.stringContaining("transform(value: unknown)"),
    });
  });

  it("uses the binding declaration for a callback-bound Tier A arrow function", () => {
    const result = buildSyntax({
      caller: "function caller() { flush(); }",
      calleeName: "flush",
      candidates: [
        candidate("tierA:flush", "src/decls.ts#flush", "src/decls.ts", "flush"),
      ],
      files: {
        "src/decls.ts": `describe("queue", () => {\n  const flush = () => {};\n});`,
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "present",
      declarationKind: "variable",
      signatureSnippet: "flush = () => {}",
    });
  });

  it("resolves a class member when the class is declared inside a callback", () => {
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate(
          "tierA:run",
          "src/decls.ts#Service.run",
          "src/decls.ts",
          "run",
        ),
      ],
      files: {
        "src/decls.ts": `describe("service", () => {\n  class Service {\n    run(value: string) { return value; }\n  }\n});`,
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "present",
      declarationKind: "method",
      signatureSnippet: expect.stringContaining("run(value: string)"),
    });
  });

  it("uses an @L suffix to resolve an object-literal method in a callback", () => {
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate("tierA:run", "src/decls.ts#run@L5", "src/decls.ts", "run"),
      ],
      files: {
        "src/decls.ts": `describe("adapter", () => {\n  const first = {\n    run() {},\n  };\n  const adapter = {\n    run(value: string) { return value; },\n  };\n});`,
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "present",
      declarationKind: "method",
      signatureSnippet: expect.stringContaining("run(value: string)"),
    });
  });

  it("matches a decorated class method by its name line inside a callback", () => {
    const result = buildSyntax({
      caller: "function caller() { warn(); }",
      calleeName: "warn",
      candidates: [
        candidate(
          "tierA:warn",
          "src/decls.ts#Logger.warn@L4",
          "src/decls.ts",
          "warn",
        ),
      ],
      files: {
        "src/decls.ts": [
          'describe("logger", () => {',
          "  class Logger {",
          "    warn() {}",
          "    @Trace()",
          "    warn(message: string) {}",
          "  }",
          "});",
        ].join("\n"),
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "present",
      declarationKind: "method",
      signatureSnippet: expect.stringContaining("warn(message: string)"),
    });
  });

  it("does not let a same-named property inside a method shadow a class member", () => {
    const result = buildSyntax({
      caller: "function caller() { transform(); }",
      calleeName: "transform",
      candidates: [
        candidate(
          "tierA:transform",
          "src/decls.ts#ParseArrayPipe.transform",
          "src/decls.ts",
          "transform",
        ),
      ],
      files: {
        "src/decls.ts": [
          "class ParseArrayPipe {",
          "  configure() { consume({ transform: true }); }",
          "  transform(value: unknown) { return value; }",
          "}",
        ].join("\n"),
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0].declarationKind).toBe("method");
    expect(result.syntax.candidates[0].signatureSnippet).toContain(
      "transform(value: unknown)",
    );
  });

  it("leaves evidence missing when a same-name declaration has no exact Tier A node key", () => {
    const result = buildSyntax({
      caller: "function caller() { transform(); }",
      calleeName: "transform",
      candidates: [
        candidate(
          "tierA:transform",
          "src/decls.ts#ParseArrayPipe.transform@L999",
          "src/decls.ts",
          "transform",
        ),
      ],
      files: {
        "src/decls.ts":
          "class ParseArrayPipe { transform(value: unknown) { return value; } }",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "missing",
      declarationKind: "unknown",
      signatureSnippet: "",
    });
  });

  it("maps the exact indexed name when Tree-sitter and TypeScript ranges differ", () => {
    const result = buildSyntax({
      caller: "function caller() { resolve(); }",
      calleeName: "resolve",
      candidates: [
        candidate(
          "tierA:resolve",
          "src/decls.ts#resolve",
          "src/decls.ts",
          "resolve",
        ),
      ],
      files: {
        "src/decls.ts": "export function resolve(): void { return; }",
      },
      tierAIndexOverride: (indexed) => ({
        ...indexed,
        endIndex: indexed.endIndex - 1,
      }),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0].signatureSnippet).toBe(
      "export function resolve(): void",
    );
  });

  it("uses the Tier A binding declaration for an exported arrow function", () => {
    const result = buildSyntax({
      caller: "function caller() { WelcomeEmail(); }",
      calleeName: "WelcomeEmail",
      candidates: [
        candidate(
          "tierA:welcome-email",
          "src/welcome.ts#WelcomeEmail",
          "src/welcome.ts",
          "WelcomeEmail",
        ),
      ],
      files: {
        "src/welcome.ts":
          "export const WelcomeEmail = (username: string) => { return username; };",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "present",
      declarationKind: "variable",
    });
    expect(result.syntax.candidates[0].signatureSnippet).toContain(
      "WelcomeEmail = (username: string) =>",
    );
  });

  it("keeps an assignment-bound arrow missing when no declaration owns its key", () => {
    const result = buildSyntax({
      caller: "function caller() { classTarget(); }",
      calleeName: "classTarget",
      candidates: [
        candidate(
          "tierA:class-target",
          "src/decls.ts#classTarget",
          "src/decls.ts",
          "classTarget",
        ),
      ],
      files: {
        "src/decls.ts":
          "function build() { let classTarget; classTarget = () => true; }",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      evidenceStatus: "missing",
      declarationKind: "unknown",
      signatureSnippet: "",
    });
  });

  it("uses the @L key for a class method when Tier A indexed an earlier same-name local function", () => {
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate(
          "tierA:run",
          "src/decls.ts#Service.run@L2",
          "src/decls.ts",
          "run",
        ),
      ],
      files: {
        "src/decls.ts": [
          "class Service {",
          "  configure() { function run() { return 1; } }",
          "  run() { return 2; }",
          "}",
        ].join("\n"),
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      declarationKind: "method",
      signatureSnippet: "run()",
    });
  });

  it("uses the node-key line to distinguish same-named methods in sibling classes", () => {
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate(
          "tierA:run",
          "src/decls.ts#Second.run",
          "src/decls.ts",
          "run",
        ),
      ],
      files: {
        "src/decls.ts": [
          "class First {",
          "  run(value: string) { return value; }",
          "}",
          "class Second {",
          "  run(value: number) { return value; }",
          "}",
        ].join("\n"),
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0].signatureSnippet).toContain(
      "run(value: number)",
    );
  });

  it("uses Tier A's overload implementation for a base node key", () => {
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate(
          "tierA:run",
          "src/decls.ts#Service.run",
          "src/decls.ts",
          "run",
        ),
      ],
      files: {
        "src/decls.ts": [
          "class Service {",
          "  @Trace()",
          "  run(value: string): string;",
          "  run(value: number): number;",
          "  run(value: string | number): string | number { return value; }",
          "}",
        ].join("\n"),
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0]).toMatchObject({
      declarationKind: "method",
      overloadCount: 3,
    });
    expect(result.syntax.candidates[0].signatureSnippet).toContain(
      "run(value: string | number): string | number",
    );
  });

  it("counts overloads only within a callable declaration group", () => {
    const result = buildSyntax({
      caller: "function caller() { transform(); }",
      calleeName: "transform",
      candidates: [
        candidate(
          "tierA:transform",
          "src/api.ts#transform",
          "src/api.ts",
          "transform",
        ),
      ],
      files: {
        "src/api.ts":
          "export function transform(value: string): string;\nexport function transform(value: number): number;\nexport function transform(value: string | number): string | number { return value; }",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0].overloadCount).toBe(3);
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
    ).toContain(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS);
  });

  it("does not count same-named methods in separate object literals as overloads", () => {
    const result = buildSyntax({
      caller: "function caller() { return parser.transform(1); }",
      calleeName: "transform",
      candidates: [
        candidate(
          "tierA:transform",
          "src/api.ts#transform",
          "src/api.ts",
          "transform",
        ),
      ],
      files: {
        "src/api.ts":
          "function build() { const parser = { transform(value: number) { return value; } }; const registry = { transform(value: string) { return value; } }; return parser.transform(1); }",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0].overloadCount).toBe(1);
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
    ).not.toContain(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS);
  });

  it("does not count a getter and setter pair as overloads", () => {
    const result = buildSyntax({
      caller: "function caller() { value(); }",
      calleeName: "value",
      candidates: [
        candidate(
          "tierA:value",
          "src/api.ts#Service.value",
          "src/api.ts",
          "value",
        ),
      ],
      files: {
        "src/api.ts":
          "class Service { get value(): string { return ''; } set value(next: string) {} }",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.candidates[0].overloadCount).toBe(1);
    expect(
      classifySystem1Ambiguities(result.syntax.ambiguityEvidence).tags,
    ).not.toContain(SYSTEM1_AMBIGUITY_CLASSES.OVERLOADS);
  });

  it("resolves JSONC tsconfig extends and paths without baseUrl for alias barrels", () => {
    const snapshotRoot = "/snapshot";
    const files = new Map<string, string>([
      [
        "tsconfig.json",
        `{"extends":"./base.json","compilerOptions":{"target":"ES2022",},"include":["src/**/*.ts"]}`,
      ],
      [
        "base.json",
        `{"compilerOptions":{"paths":{"@opal/*":["./src/*"]},"moduleResolution":"Bundler"}}`,
      ],
      [
        "src/caller.ts",
        'import { execute } from "@opal/index"; function caller() { execute(); }',
      ],
      ["src/index.ts", 'export { execute } from "./implementation";'],
      ["src/implementation.ts", "export function execute(): void {}"],
    ]);
    const trackedFiles = new Set(files.keys());
    const snapshotPath = (file: string): string =>
      path.relative(snapshotRoot, file).split(path.sep).join("/");
    const moduleHost: ts.ModuleResolutionHost = {
      fileExists: (file) => trackedFiles.has(snapshotPath(file)),
      readFile: (file) => files.get(snapshotPath(file)),
      directoryExists: (directory) => {
        const prefix = `${snapshotPath(directory).replace(/\/$/, "")}/`;
        return [...trackedFiles].some((file) => file.startsWith(prefix));
      },
      getDirectories: (directory) => {
        const prefix = `${snapshotPath(directory).replace(/\/$/, "")}/`;
        const directories = new Set<string>();
        for (const file of trackedFiles) {
          if (!file.startsWith(prefix)) continue;
          const rest = file.slice(prefix.length);
          const slash = rest.indexOf("/");
          if (slash >= 0)
            directories.add(path.join(directory, rest.slice(0, slash)));
        }
        return [...directories];
      },
      getCurrentDirectory: () => snapshotRoot,
      realpath: (file) => file,
      useCaseSensitiveFileNames: true,
    };
    const environment: Pick<
      System1SyntaxEnvironment,
      "projectOptions" | "resolveModule"
    > = {
      projectOptions: (projectId) =>
        parseSystem1ProjectOptions({
          configPath: path.resolve(snapshotRoot, projectId),
          snapshotRoot,
          trackedFiles,
          readText: (file) => files.get(file),
        }),
      resolveModule: (specifier, callerFile, options) => {
        const resolved = ts.resolveModuleName(
          specifier,
          path.resolve(snapshotRoot, callerFile),
          options,
          moduleHost,
        ).resolvedModule?.resolvedFileName;
        if (!resolved) return undefined;
        const relative = snapshotPath(resolved);
        return trackedFiles.has(relative) ? relative : undefined;
      },
    };
    const result = buildSyntax({
      caller: files.get("src/caller.ts") ?? "",
      calleeName: "execute",
      candidates: [
        candidate(
          "tierA:execute",
          "src/implementation.ts#execute",
          "src/implementation.ts",
          "execute",
        ),
      ],
      files: Object.fromEntries(
        [...files].filter(([file]) => file !== "src/caller.ts"),
      ),
      ...environment,
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.syntax.importBinding).toMatchObject({
      pathAlias: true,
      barrelStatus: "yes",
    });
  });

  it("recognizes forwarding to a declared named method, not ordinary one-liners", () => {
    const positive = buildSyntax({
      caller: "function caller() { addChild(1); }",
      calleeName: "addChild",
      candidates: [
        candidate(
          "tierA:tree",
          "src/tree.ts#TreeNode.addChild",
          "src/tree.ts",
          "addChild",
        ),
      ],
      files: {
        "src/tree.ts":
          "export class TreeNode { addChild(child: Node) { return this.addChildInternal(child); } private addChildInternal(child: Node) { return child; } }",
      },
    });
    const regex = buildSyntax({
      caller: "function caller() { test(); }",
      calleeName: "test",
      candidates: [
        candidate("tierA:regex", "src/regex.ts#test", "src/regex.ts", "test"),
      ],
      files: {
        "src/regex.ts":
          "export function test(value: string) { return /x/.test(value); }",
      },
    });
    const map = buildSyntax({
      caller: "function caller() { lookup(); }",
      calleeName: "lookup",
      candidates: [
        candidate("tierA:map", "src/map.ts#lookup", "src/map.ts", "lookup"),
      ],
      files: {
        "src/map.ts":
          "export function lookup(map: Map<string, string>, key: string) { return map.get(key); }",
      },
    });

    expect(positive.kind).toBe("ready");
    expect(regex.kind).toBe("ready");
    expect(map.kind).toBe("ready");
    if (positive.kind === "ready")
      expect(positive.syntax.candidates[0].forwardingWrapper).toBe(true);
    if (regex.kind === "ready")
      expect(regex.syntax.candidates[0].forwardingWrapper).toBe(false);
    if (map.kind === "ready")
      expect(map.syntax.candidates[0].forwardingWrapper).toBe(false);
  });

  it("finds constructors, accessors, and object-literal members", () => {
    const result = buildSyntax({
      caller: "function caller() { run(); }",
      calleeName: "run",
      candidates: [
        candidate(
          "tierA:constructor",
          "src/decls.ts#Service.constructor",
          "src/decls.ts",
          "constructor",
        ),
        candidate(
          "tierA:accessor",
          "src/decls.ts#Service.value",
          "src/decls.ts",
          "value",
        ),
        candidate("tierA:object", "src/decls.ts#run", "src/decls.ts", "run"),
      ],
      files: {
        "src/decls.ts":
          "class Service { constructor(value: string) {} get value(): string { return ''; } }\nconst client = { run: function() {} };",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(
      result.syntax.candidates.map(({ declarationKind, evidenceStatus }) => [
        declarationKind,
        evidenceStatus,
      ]),
    ).toEqual([
      ["constructor", "present"],
      ["method", "present"],
      ["property", "present"],
    ]);
  });
});

interface CandidateFixture {
  readonly id: string;
  readonly targetId: string;
  readonly filePath: string;
  readonly name: string;
}

function candidate(
  id: string,
  targetId: string,
  filePath: string,
  name: string,
): CandidateFixture {
  return { id, targetId, filePath, name };
}

function buildSyntax(input: {
  readonly caller: string;
  readonly calleeName: string;
  readonly candidates: readonly CandidateFixture[];
  readonly files: Readonly<Record<string, string>>;
  readonly projectOptions?: System1SyntaxEnvironment["projectOptions"];
  readonly resolveModule?: System1SyntaxEnvironment["resolveModule"];
  readonly tierAIndexOverride?: (
    indexed: TierAIndexedDeclaration,
  ) => TierAIndexedDeclaration;
}) {
  const callerPath = "src/caller.ts";
  const files = new Map<string, string>([
    [callerPath, input.caller],
    ...Object.entries(input.files),
  ]);
  const callOffset = input.caller.indexOf(`${input.calleeName}(`);
  const beforeCall = input.caller.slice(0, callOffset);
  const callSite: SemanticCollectionCallSite = {
    filePath: callerPath,
    line: beforeCall.split("\n").length - 1,
    column: beforeCall.length - (beforeCall.lastIndexOf("\n") + 1),
    calleeName: input.calleeName,
    calleeKind: null,
  };
  const candidateSet = {
    candidates: input.candidates.map(({ id, targetId }) => ({ id, targetId })),
    truncated: false,
    matchCount: input.candidates.length,
  };
  const nodes = new Map<string, SemanticCollectionGraphNode>(
    input.candidates.map(({ targetId, filePath, name }) => [
      targetId,
      { nodeKey: targetId, filePath, name },
    ]),
  );
  const ranks = new Map(
    input.candidates.map(({ targetId }) => [
      targetId,
      { rank: 2 as const, evidence: "tier-a-same-name" as const },
    ]),
  );
  const tierAIndex = new Map<
    string,
    Map<string, ReturnType<typeof extractTierAIndexedDeclarations>[number]>
  >();
  for (const [file, source] of files) {
    const tree = system1TestParser.parse(source);
    if (!tree) continue;
    const declarations = extractTierAIndexedDeclarations(
      file,
      tree,
      system1TestProvider,
    );
    tree.delete();
    tierAIndex.set(
      file,
      new Map(
        declarations.map((declaration) => {
          const indexed =
            input.tierAIndexOverride?.(declaration) ?? declaration;
          return [indexed.nodeKey, indexed];
        }),
      ),
    );
  }
  const syntax = new System1SnapshotSyntax({
    trackedFiles: new Set(files.keys()),
    readText: (file) => files.get(file),
    tierADeclaration: (file, targetId) => tierAIndex.get(file)?.get(targetId),
    projectOptions:
      input.projectOptions ?? (() => ({ options: {}, parsed: true })),
    resolveModule: input.resolveModule ?? (() => undefined),
  });
  return syntax.build(callSite, candidateSet, nodes, ranks, "tsconfig.json");
}
