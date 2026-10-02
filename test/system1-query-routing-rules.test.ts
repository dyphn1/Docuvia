import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  combineSystem1QueryResults,
  System1QuerySourceIndex,
  resolveSystem1DeterministicQueries,
  type System1QueryState,
} from "../scripts/semantic-corpus/system1-query-routing-rules.mts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(files: Readonly<Record<string, string>>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "system1-query-rules-"));
  temporaryRoots.push(root);
  const tracked = new Set<string>();
  for (const [file, contents] of Object.entries(files)) {
    const absolute = path.join(root, file);
    const directory = path.dirname(absolute);
    mkdirSync(directory, { recursive: true });
    writeFileSync(absolute, contents);
    tracked.add(file.replaceAll(path.sep, "/"));
  }
  return { root, source: new System1QuerySourceIndex(root, tracked) };
}

function state(
  options: readonly string[],
  context: unknown,
): System1QueryState {
  return {
    request: {
      requestId: "synthetic-request",
      evidence: {
        repoId: "github.com/example/repo",
        worktreeId: "revision",
        projectId: "tsconfig.json",
        snapshotHash: "snapshot",
      },
      context: { text: JSON.stringify(context) },
      options: options.map((targetId, index) => ({
        id: `candidate-${index}`,
        kind: "candidate",
        attributes: { targetId },
      })),
    },
  } as System1QueryState;
}

function run(
  source: System1QuerySourceIndex,
  options: readonly string[],
  context: unknown,
  callSitePosition?: { readonly line: number; readonly column: number },
) {
  return resolveSystem1DeterministicQueries(
    state(options, context),
    source,
    callSitePosition,
  );
}

describe("System-1 deterministic query routing", () => {
  it("[happy] Q1 commits only the candidate declared by the direct import source", () => {
    const { source } = fixture({
      "caller.ts": "import { wanted } from './direct'; wanted();",
      "direct.ts": "export function wanted() {}",
      "decoy.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["direct.ts#wanted", "decoy.ts#wanted"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "wanted()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    });

    expect(results.q1).toMatchObject({
      status: "commit",
      optionId: "candidate-0",
      targetId: "direct.ts#wanted",
    });
  });

  it("uses the exact supplied position to select one of two identical calls", () => {
    const { source } = fixture({
      "caller.ts": "import { wanted } from './direct';\nwanted(); wanted();",
      "direct.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });
    const context = {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "wanted()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    };

    const results = run(source, ["direct.ts#wanted"], context, {
      line: 1,
      column: 10,
    });

    expect(results.q1).toMatchObject({
      status: "commit",
      targetId: "direct.ts#wanted",
    });
  });

  it("abstains when the supplied position is not on the callee expression", () => {
    const { source } = fixture({
      "caller.ts": "import { wanted } from './direct';\nwanted(); wanted();",
      "direct.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });
    const context = {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "wanted()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    };

    const results = run(source, ["direct.ts#wanted"], context, {
      line: 1,
      column: 7,
    });

    expect(results.q1).toMatchObject({
      status: "abstain",
      reason: "callsite-not-at-position",
    });
  });

  it("does not let an out-of-range column wrap into the following line", () => {
    const importLine = "import { wanted } from './direct';";
    const { source } = fixture({
      "caller.ts": `${importLine}\nwanted();`,
      "direct.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });
    const context = {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "wanted()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    };

    const results = run(source, ["direct.ts#wanted"], context, {
      line: 0,
      column: importLine.length + 2,
    });

    expect(results.q1).toMatchObject({
      status: "abstain",
      reason: "callsite-not-at-position",
    });
  });

  it("rejects a request expression that disagrees with the positioned call", () => {
    const { source } = fixture({
      "caller.ts": "import { wanted } from './direct';\nwanted();",
      "direct.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });
    const context = {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "other()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    };

    const results = run(source, ["direct.ts#wanted"], context, {
      line: 1,
      column: 0,
    });

    expect(results.q1).toMatchObject({
      status: "abstain",
      reason: "callsite-context-mismatch",
    });
  });

  it("Q1 abstains when Tier A lists a same-name declaration disambiguated by line", () => {
    const { source } = fixture({
      "caller.ts": "import { file } from './fake'; file();",
      "fake.ts":
        "const helpers = { file() {} };\nexport const file = () => helpers.file();",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["fake.ts#file", "fake.ts#file@L2"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "file", expression: "file()" },
      importBinding: {
        kind: "named",
        local: "file",
        imported: "file",
        sourceSpecifier: "./fake",
        pathAlias: false,
      },
    });

    expect(results.q1).toMatchObject({
      status: "abstain",
      reason: "same-name-declarations-in-options",
    });
    expect(results.cascade).toMatchObject({ status: "abstain" });
  });

  it("[error-handling] every query abstains when the caller file is missing from the snapshot", () => {
    const { source } = fixture({
      "direct.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["direct.ts#wanted", "decoy.ts#wanted"], {
      caller: { filePath: "missing-caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "wanted()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    });

    expect(results.q1).toMatchObject({
      status: "abstain",
      reason: "caller-file-unparseable",
    });
    expect(results.cascade).toMatchObject({ status: "abstain" });
  });

  it("[invalid-input] Q1 abstains when the request call does not invoke its import binding", () => {
    const { source } = fixture({
      "caller.ts": "import { wanted } from './direct'; unrelated();",
      "direct.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["direct.ts#wanted"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: {
        kind: "bare",
        calleeName: "unrelated",
        expression: "unrelated()",
      },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    });

    expect(results.q1.status).toBe("abstain");
  });

  it("Q1 abstains when the imported local name is declared more than once", () => {
    const { source } = fixture({
      "caller.ts":
        "import { wanted } from './direct'; import { wanted } from './decoy'; wanted();",
      "direct.ts": "export function wanted() {}",
      "decoy.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["direct.ts#wanted"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "wanted()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./direct",
        pathAlias: false,
      },
    });

    expect(results.q1.status).toBe("abstain");
  });

  it("Q1 resolves a configured path alias and a default export", () => {
    const { source } = fixture({
      "src/caller.ts": "import Client from '@lib/client'; Client();",
      "src/lib/client.ts": "export default class Client {}",
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}',
    });

    const results = run(source, ["src/lib/client.ts#Client"], {
      caller: { filePath: "src/caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "Client", expression: "Client()" },
      importBinding: {
        kind: "default",
        local: "Client",
        imported: "default",
        sourceSpecifier: "@lib/client",
        pathAlias: true,
      },
    });

    expect(results.q1).toMatchObject({
      status: "commit",
      targetId: "src/lib/client.ts#Client",
    });
  });

  it("Q1 abstains on a re-export and Q2 follows the explicit alias", () => {
    const { source } = fixture({
      "caller.ts": "import { entry } from './barrel'; entry();",
      "barrel.ts": "export { actual as entry } from './leaf';",
      "leaf.ts": "export function actual() {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["leaf.ts#actual", "barrel.ts#entry"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "entry", expression: "entry()" },
      importBinding: {
        kind: "named",
        local: "entry",
        imported: "entry",
        sourceSpecifier: "./barrel",
        pathAlias: false,
      },
    });

    expect(results.q1.status).toBe("abstain");
    expect(results.q2).toMatchObject({
      status: "commit",
      optionId: "candidate-0",
      targetId: "leaf.ts#actual",
    });
  });

  it("Q1 does not mistake an imported local alias for a declaration", () => {
    const { source } = fixture({
      "caller.ts": "import { alias } from './barrel'; alias();",
      "barrel.ts":
        "import { actual } from './leaf'; export { actual as alias };",
      "leaf.ts": "export function actual() {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["barrel.ts#actual", "leaf.ts#actual"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "alias", expression: "alias()" },
      importBinding: {
        kind: "named",
        local: "alias",
        imported: "alias",
        sourceSpecifier: "./barrel",
        pathAlias: false,
      },
    });

    expect(results.q1.status).toBe("abstain");
  });

  it("Q2 abstains when multiple export-star sources define the imported name", () => {
    const { source } = fixture({
      "caller.ts": "import { wanted } from './barrel'; wanted();",
      "barrel.ts": "export * from './left'; export * from './right';",
      "left.ts": "export function wanted() {}",
      "right.ts": "export function wanted() {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["left.ts#wanted", "right.ts#wanted"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "wanted", expression: "wanted()" },
      importBinding: {
        kind: "named",
        local: "wanted",
        imported: "wanted",
        sourceSpecifier: "./barrel",
        pathAlias: false,
      },
    });

    expect(results.q2).toMatchObject({
      status: "abstain",
      reason: "ambiguous-export-star",
    });
  });

  it("Q2 follows a default re-export alias to its named class declaration", () => {
    const { source } = fixture({
      "caller.ts": "import { alias } from './barrel'; alias();",
      "barrel.ts": "export { default as alias } from './leaf';",
      "leaf.ts": "export default class Actual {}",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["leaf.ts#Actual"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "bare", calleeName: "alias", expression: "alias()" },
      importBinding: {
        kind: "named",
        local: "alias",
        imported: "alias",
        sourceSpecifier: "./barrel",
        pathAlias: false,
      },
    });

    expect(results.q2).toMatchObject({
      status: "commit",
      targetId: "leaf.ts#Actual",
    });
  });

  it("Q3 resolves a uniquely annotated receiver through its imported class", () => {
    const { source } = fixture({
      "caller.ts":
        "import { Client } from './client'; function caller(x: Client) { return x.run(); }",
      "client.ts": "export class Client { run() {} }",
      "other.ts": "export class Other { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(
      source,
      ["client.ts#Client.run", "other.ts#Other.run"],
      {
        caller: { filePath: "caller.ts", symbol: "caller" },
        call: { kind: "member", calleeName: "run", expression: "x.run()" },
        importBinding: null,
      },
    );

    expect(results.q3).toMatchObject({
      status: "commit",
      optionId: "candidate-0",
      targetId: "client.ts#Client.run",
    });
  });

  it("Q3 uses the exact supplied position among identical member calls", () => {
    const calls = "function caller(x: Client) { x.run(); x.run(); }";
    const { source } = fixture({
      "caller.ts": `import { Client } from './client';\n${calls}`,
      "client.ts": "export class Client { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(
      source,
      ["client.ts#Client.run"],
      {
        caller: { filePath: "caller.ts", symbol: "caller" },
        call: { kind: "member", calleeName: "run", expression: "x.run()" },
        importBinding: null,
      },
      { line: 1, column: calls.lastIndexOf("x.run") },
    );

    expect(results.q3).toMatchObject({
      status: "commit",
      targetId: "client.ts#Client.run",
      proof: "receiver-parameter-type",
    });
  });

  it("Q3 rejects a positioned call that disagrees with the request expression", () => {
    const { source } = fixture({
      "caller.ts":
        "import { Client } from './client';\nfunction caller(x: Client) { x.run(); }",
      "client.ts": "export class Client { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(
      source,
      ["client.ts#Client.run"],
      {
        caller: { filePath: "caller.ts", symbol: "caller" },
        call: { kind: "member", calleeName: "run", expression: "other.run()" },
        importBinding: null,
      },
      { line: 1, column: 32 },
    );

    expect(results.q3).toMatchObject({
      status: "abstain",
      reason: "callsite-context-mismatch",
    });
  });

  it("Q3 follows an explicit extends chain for this.m()", () => {
    const { source } = fixture({
      "caller.ts":
        "import { Base } from './base'; class Child extends Base { invoke() { return this.run(); } }",
      "base.ts": "export class Base { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["base.ts#Base.run"], {
      caller: { filePath: "caller.ts", symbol: "Child.invoke" },
      call: { kind: "member", calleeName: "run", expression: "this.run()" },
      importBinding: null,
    });

    expect(results.q3).toMatchObject({
      status: "commit",
      targetId: "base.ts#Base.run",
      proof: "receiver-enclosing-class-explicit-extends",
    });
  });

  it("Q3 resolves this.x.m() from an explicit class-field type", () => {
    const { source } = fixture({
      "caller.ts":
        "import { Client } from './client'; class Caller { private client: Client; invoke() { return this.client.run(); } }",
      "client.ts": "export class Client { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["client.ts#Client.run"], {
      caller: { filePath: "caller.ts", symbol: "Caller.invoke" },
      call: {
        kind: "member",
        calleeName: "run",
        expression: "this.client.run()",
      },
      importBinding: null,
    });

    expect(results.q3).toMatchObject({
      status: "commit",
      targetId: "client.ts#Client.run",
      proof: "receiver-class-field-type",
    });
  });

  it("Q3 resolves a local const constructed from an imported class", () => {
    const { source } = fixture({
      "caller.ts":
        "import { Client } from './client'; function caller() { const client = new Client(); return client.run(); }",
      "client.ts": "export class Client { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["client.ts#Client.run"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: {
        kind: "member",
        calleeName: "run",
        expression: "client.run()",
      },
      importBinding: null,
    });

    expect(results.q3).toMatchObject({
      status: "commit",
      targetId: "client.ts#Client.run",
      proof: "receiver-const-constructor",
    });
  });

  it("Q1 abstains on a member call while Q3 resolves its typed receiver", () => {
    const { source } = fixture({
      "caller.ts":
        "import { Client } from './client'; function caller(x: Client) { return x.run(); }",
      "client.ts": "export class Client { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(source, ["client.ts#Client", "client.ts#Client.run"], {
      caller: { filePath: "caller.ts", symbol: "caller" },
      call: { kind: "member", calleeName: "run", expression: "x.run()" },
      importBinding: {
        kind: "named",
        local: "Client",
        imported: "Client",
        sourceSpecifier: "./client",
        pathAlias: false,
      },
    });

    expect(results.q1.status).toBe("abstain");
    expect(results.cascade).toMatchObject({
      status: "commit",
      targetId: "client.ts#Client.run",
    });
  });

  it("the cascade abstains if independent queries commit different targets", () => {
    const combined = combineSystem1QueryResults({
      q1: {
        status: "commit",
        optionId: "class",
        targetId: "client.ts#Client",
        proof: "q1",
      },
      q2: { status: "abstain", reason: "test" },
      q3: {
        status: "commit",
        optionId: "method",
        targetId: "client.ts#Client.run",
        proof: "q3",
      },
    });

    expect(combined.cascade).toMatchObject({
      status: "abstain",
      reason: "query-conflict",
      conflictTargets: ["client.ts#Client", "client.ts#Client.run"],
    });
  });

  it("Q3 abstains on a union receiver instead of selecting an implementation", () => {
    const { source } = fixture({
      "caller.ts":
        "import { Client } from './client'; import { Other } from './other'; function caller(x: Client | Other) { return x.run(); }",
      "client.ts": "export class Client { run() {} }",
      "other.ts": "export class Other { run() {} }",
      "tsconfig.json": "{}",
    });

    const results = run(
      source,
      ["client.ts#Client.run", "other.ts#Other.run"],
      {
        caller: { filePath: "caller.ts", symbol: "caller" },
        call: { kind: "member", calleeName: "run", expression: "x.run()" },
        importBinding: null,
      },
    );

    expect(results.q3).toMatchObject({
      status: "abstain",
      reason: "unsupported-receiver-type",
    });
  });
});
