import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Language, Parser, type Tree } from "web-tree-sitter";
import { resolveWasmPath } from "./resolve-wasm-path.js";
import { extractDeclaredTypeFacts } from "./declared-type-facts.js";
import type { AstDeclaredTypeLanguage } from "@workspace/contracts";

const GRAMMARS: Record<AstDeclaredTypeLanguage, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
};

const parsers = new Map<AstDeclaredTypeLanguage, Parser>();

beforeAll(async () => {
  await Parser.init();
  for (const [language, wasmFile] of Object.entries(GRAMMARS) as Array<
    [AstDeclaredTypeLanguage, string]
  >) {
    const { wasmPath } = resolveWasmPath(wasmFile);
    const grammar = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(grammar);
    parsers.set(language, parser);
  }
});

afterAll(() => {
  for (const parser of parsers.values()) parser.delete();
  parsers.clear();
});

function parse(source: string, language: AstDeclaredTypeLanguage): Tree {
  const tree = parsers.get(language)?.parse(source);
  if (!tree) throw new Error(`Could not parse ${language} fixture`);
  return tree;
}

function extract(source: string, language: AstDeclaredTypeLanguage) {
  const tree = parse(source, language);
  try {
    return extractDeclaredTypeFacts(tree.rootNode, language);
  } finally {
    tree.delete();
  }
}

describe("declared type facts from real tree-sitter WASM grammars", () => {
  it.each([
    {
      language: "typescript" as const,
      source: [
        "class Service extends Base implements Contract {",
        "  readonly repository: Repository;",
        "  readonly cache = new Cache();",
        "  process(request: Request): Response { return {} as Response; }",
        "  constructor(@Inject(TOKEN) private readonly injected: Repository, plain: Plain) {}",
        "}",
        "interface ExtendedContract extends BaseContract { payload: Payload; }",
        "const instance: Service = new Service();",
        "function create(): Service { return new Service(); }",
        "const make = (request: Request): Response => request as unknown as Response;",
      ].join("\n"),
      expected: [
        ["extends", "Base"],
        ["extends", "BaseContract"],
        ["field-annotation", "Payload"],
        ["implements", "Contract"],
        ["field-annotation", "Repository"],
        ["new-initializer", "Cache"],
        ["parameter-annotation", "Request"],
        ["return-annotation", "Response"],
        ["parameter-property", "Repository"],
        ["parameter-annotation", "Plain"],
        ["variable-annotation", "Service"],
        ["new-initializer", "Service"],
        ["parameter-annotation", "Request"],
        ["return-annotation", "Response"],
      ],
    },
    {
      language: "tsx" as const,
      source: [
        "class View {",
        "  readonly client: Client;",
        "  render(request: Request): Response { return <Panel /> as unknown as Response; }",
        "}",
      ].join("\n"),
      expected: [
        ["field-annotation", "Client"],
        ["parameter-annotation", "Request"],
        ["return-annotation", "Response"],
      ],
    },
  ])(
    "[happy] extracts explicit source relations for $language",
    ({ language, source, expected }) => {
      const result = extract(source, language);
      expect(result.schemaVersion).toBe(1);
      expect(result.language).toBe(language);
      for (const [kind, typeName] of expected)
        expect(result.facts).toContainEqual(
          expect.objectContaining({ kind, typeName }),
        );

      for (const fact of result.facts) {
        expect(source.slice(fact.typeSpan.start, fact.typeSpan.end)).toBe(
          fact.typeText,
        );
        expect(fact.typeText).toBe(fact.typeName);
        expect(
          source.slice(fact.declarationSpan.start, fact.declarationSpan.end),
        ).not.toBe("");
        expect(fact.owner.span.end).toBeGreaterThan(fact.owner.span.start);
        expect(fact.lexicalScopeSpan.end).toBeGreaterThan(
          fact.lexicalScopeSpan.start,
        );
      }
    },
  );

  it("[happy] keeps source spans in UTF-16 code units after astral characters", () => {
    const source = 'const label = "🪵";\nclass Client { service: Service; }';
    const result = extract(source, "typescript");
    const service = result.facts.find(
      (fact) => fact.kind === "field-annotation",
    );
    expect(service).toBeDefined();
    expect(service?.typeSpan.start).toBe(source.indexOf("Service"));
    expect(source.slice(service!.typeSpan.start, service!.typeSpan.end)).toBe(
      "Service",
    );
  });

  it("[happy] abstains on generic shadowing and unsupported compound type syntax", () => {
    const source = [
      "class Box<T> {",
      "  value: T;",
      "  compound: Client | Other;",
      "  wrapped: Promise<Client>;",
      "  intersection: Client & Other;",
      "  mapped: { [K in keyof T]: T[K] };",
      "  conditional: T extends Client ? Result : Other;",
      "  object: { client: Client };",
      '  indexed: Registry["client"];',
      "  callable: (request: Request) => Response;",
      "  choose<T>(value: T): T;",
      "  use(client: Client): Result { return {} as Result; }",
      "}",
      "const generic: Box = new Box();",
      "const explicitGeneric = new Box<Client>();",
      "class GenericChild extends Base<Client> {}",
    ].join("\n");
    const result = extract(source, "typescript");
    expect(result.facts.map((fact) => fact.typeName)).toEqual([
      "Result",
      "Client",
      "Box",
      "Box",
    ]);
    expect(result.facts.some((fact) => fact.typeName === "T")).toBe(false);
    expect(result.facts.some((fact) => fact.typeName === "Other")).toBe(false);
    expect(result.facts.some((fact) => fact.typeName === "Base")).toBe(false);
    expect(result.facts.some((fact) => fact.typeName === "Request")).toBe(
      false,
    );
    expect(
      result.ownerInventories.find(
        (inventory) => inventory.owner.name === "Box",
      )?.owner.genericTypeParameterNames,
    ).toEqual(["T"]);
    expect(
      result.declarations.find((declaration) => declaration.name === "choose")
        ?.genericTypeParameterNames,
    ).toEqual(["T"]);
  });

  it("[happy] preserves callable/member inventory independently of annotations", () => {
    const source = [
      "abstract class Api {",
      "  abstract request(input: Request): Response;",
      "  private secret(value: Secret): void {}",
      "  protected optional?(input?: Optional): Result;",
      "  static build(first: First, second: Second = fallback, ...rest: Rest[]): Api { return this; }",
      "  overloaded(value: string): string;",
      "  overloaded(value: number): number;",
      "  constructor(@Inject(TOKEN) readonly anonymousRepo: Repository, plain: Plain) {}",
      "  [dynamicName](): void;",
      "}",
    ].join("\n");
    const result = extract(source, "typescript");
    const declarations = result.declarations;
    const request = declarations.find((item) => item.name === "request");
    const secret = declarations.find((item) => item.name === "secret");
    const optional = declarations.find((item) => item.name === "optional");
    const build = declarations.find((item) => item.name === "build");
    const injected = declarations.find((item) => item.name === "anonymousRepo");
    expect(request).toMatchObject({ kind: "method", isAbstract: true });
    expect(secret).toMatchObject({ visibility: "private" });
    expect(optional).toMatchObject({
      visibility: "protected",
      isOptional: true,
    });
    expect(build).toMatchObject({
      isStatic: true,
      arity: { requiredParameterCount: 1, maxParameterCount: null },
    });
    expect(
      declarations.filter((item) => item.name === "overloaded"),
    ).toHaveLength(2);
    expect(injected).toMatchObject({ kind: "field", visibility: "public" });
    expect(declarations.some((item) => item.name === "plain")).toBe(false);
    expect(
      declarations.some(
        (item) => item.kind === "unknown" && item.name === null,
      ),
    ).toBe(true);
    expect(
      result.ownerInventories.some(
        (inventory) =>
          inventory.owner.name === "Api" &&
          !inventory.complete &&
          inventory.incompleteReasons.includes("computed-name"),
      ),
    ).toBe(true);
  });

  it("[happy] counts untyped JavaScript parameters and omits JSDoc types", () => {
    const source = [
      "/** @type {DocumentedService} */",
      "let documented;",
      "class JsApi {",
      "  #secret = 1;",
      "  run(first, optional = fallback, ...rest) {}",
      "}",
      "const service = new Service();",
    ].join("\n");
    const result = extract(source, "javascript");
    expect(result.facts).toEqual([
      expect.objectContaining({ kind: "new-initializer", typeName: "Service" }),
    ]);
    expect(result.declarations).toContainEqual(
      expect.objectContaining({
        name: "run",
        arity: { requiredParameterCount: 1, maxParameterCount: null },
      }),
    );
    expect(result.declarations).toContainEqual(
      expect.objectContaining({ name: "#secret", visibility: "private" }),
    );
    expect(
      result.facts.some((fact) => fact.typeName === "DocumentedService"),
    ).toBe(false);
  });

  it("[happy] counts grammar parameters and keeps callable-valued members single", () => {
    const source = [
      "function commented(first, /* separator */ second) {}",
      "const single = value => value;",
      "class Handler { action = (input, /* separator */ next) => input; }",
      "const handlers = { callback: (event) => event };",
    ].join("\n");
    const result = extract(source, "javascript");
    const declaration = (name: string) =>
      result.declarations.find((item) => item.name === name);

    expect(declaration("commented")?.arity).toEqual({
      requiredParameterCount: 2,
      maxParameterCount: 2,
    });
    expect(declaration("single")?.arity).toEqual({
      requiredParameterCount: 1,
      maxParameterCount: 1,
    });
    expect(
      result.declarations.filter((item) => item.name === "action"),
    ).toEqual([
      expect.objectContaining({
        kind: "field",
        arity: { requiredParameterCount: 2, maxParameterCount: 2 },
      }),
    ]);
    expect(
      result.declarations.filter((item) => item.name === "callback"),
    ).toEqual([
      expect.objectContaining({
        kind: "field",
        arity: { requiredParameterCount: 1, maxParameterCount: 1 },
      }),
    ]);
  });

  it("[happy] gives var annotations their enclosing function scope", () => {
    const source = [
      "function scoped() {",
      "  if (ready) { var legacy: Service; const local: Service; }",
      "}",
    ].join("\n");
    const result = extract(source, "typescript");
    const legacy = result.facts.find((fact) => fact.name === "legacy");
    const local = result.facts.find((fact) => fact.name === "local");

    expect(legacy).toBeDefined();
    expect(local).toBeDefined();
    expect(legacy!.lexicalScopeSpan.start).toBeLessThan(
      local!.lexicalScopeSpan.start,
    );
    expect(legacy!.lexicalScopeSpan.end).toBeGreaterThan(
      local!.lexicalScopeSpan.end,
    );
    expect(
      source.slice(
        legacy!.lexicalScopeSpan.start,
        legacy!.lexicalScopeSpan.end,
      ),
    ).toContain("if (ready)");
  });

  it("[happy] indexes simple JavaScript extends but abstains on mixin and computed bases", () => {
    const source = [
      "class Base {}",
      "class Child extends Base {}",
      "class Mixed extends withMixin(Base) {}",
      'class Computed extends mixins["Base"] {}',
    ].join("\n");
    const result = extract(source, "javascript");
    expect(result.facts).toEqual([
      expect.objectContaining({
        kind: "extends",
        name: "Child",
        typeName: "Base",
      }),
    ]);
  });

  it("[happy] leaves the parsed tree untouched and returns deterministic facts", () => {
    const source = [
      "class Client<T> { service: Service; call(input: Request): Result { return {} as Result; } }",
      "const client = new Client();",
    ].join("\n");
    const tree = parse(source, "typescript");
    try {
      const before = tree.rootNode.toString();
      const first = extractDeclaredTypeFacts(tree.rootNode, "typescript");
      const second = extractDeclaredTypeFacts(tree.rootNode, "typescript");
      expect(tree.rootNode.toString()).toBe(before);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    } finally {
      tree.delete();
    }
  });

  it("[invalid-input] rejects an unsupported grammar identifier", () => {
    const tree = parse("class Client {}", "typescript");
    try {
      expect(() =>
        extractDeclaredTypeFacts(
          tree.rootNode,
          "python" as AstDeclaredTypeLanguage,
        ),
      ).toThrow(RangeError);
    } finally {
      tree.delete();
    }
  });

  it.each([
    { source: "class Broken { service: ; }", typeName: "Service" },
    { source: "const client = new ;", typeName: "Client" },
    { source: "function broken(): Client {", typeName: "Client" },
  ])(
    "[error-handling] rejects malformed declaration evidence: $source",
    ({ source, typeName }) => {
      const result = extract(source, "typescript");
      expect(result.facts.some((fact) => fact.typeName === typeName)).toBe(
        false,
      );
      if (source.includes("class Broken"))
        expect(
          result.ownerInventories.some(
            (inventory) =>
              inventory.owner.name === "Broken" &&
              !inventory.complete &&
              inventory.incompleteReasons.includes("syntax-error"),
          ),
        ).toBe(true);
    },
  );
});
