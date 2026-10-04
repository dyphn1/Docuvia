import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  LinkTypes,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { GraphStore } from "../../lib/schema/src/index.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import { GraphPersisterService } from "../../lib/core/src/graph/persist-ast-graph.js";
import { ScopeResolver } from "../../lib/core/src/graph/scope-resolver.js";
import {
  buildParsedSymbolNodeKeyIndex,
  nodeKeyForResolverTarget,
  nodeKeyForSourceFunction,
  registerScopeResolverFiles,
  resolveScopeResolverProposal,
} from "../../scripts/semantic-corpus/phase0-tiered-call-resolution-replay.mts";

type Sources = Record<string, string>;

const workerPool = new AstWorkerPool();
const persister = new GraphPersisterService();

describe("Phase 0 scope resolver parity with persisted graph state", () => {
  let workspaceRoot: string;
  let store: GraphStore;
  let projectId: number;

  beforeAll(async () => {
    await workerPool.initialize(1);
  });

  afterAll(async () => {
    await workerPool.terminate();
  });

  beforeEach(async () => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-phase0-call-parity-"),
    );
    fs.mkdirSync(path.join(workspaceRoot, ".docuvia"), { recursive: true });
    store = await GraphStore.open({
      dbPath: path.join(workspaceRoot, ".docuvia", "graph.sqlite"),
    });
    projectId = store.projects.insert({
      name: "phase0-call-parity",
      repoUrl: `file://${workspaceRoot}`,
    }).id;
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  async function parseSources(
    sources: Sources,
  ): Promise<ParsedAstFileResult[]> {
    return Promise.all(
      Object.entries(sources).map(async ([file, code]) => {
        const absolutePath = path.join(workspaceRoot, file);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, code, "utf8");

        const response = await workerPool.parse({
          filePath: absolutePath,
          code,
          language: "typescript",
        });
        if (!response.success || !response.data) {
          throw new Error(
            `AstWorkerPool failed to parse ${file}: ${response.error ?? "no parse data"}`,
          );
        }

        return {
          file,
          hash: crypto.createHash("sha256").update(code).digest("hex"),
          data: response.data,
          language: "typescript",
        };
      }),
    );
  }

  async function persistSources(
    sources: Sources,
  ): Promise<ParsedAstFileResult[]> {
    const parsedResults = await parseSources(sources);
    await persister.persist({
      store,
      workspaceRoot,
      projectId,
      parsedResults,
      tags: [],
    });
    return parsedResults;
  }

  function replayCalls(parsedResults: ParsedAstFileResult[]) {
    const resolver = new ScopeResolver(workspaceRoot);
    registerScopeResolverFiles(resolver, parsedResults);
    const index = buildParsedSymbolNodeKeyIndex(parsedResults);

    return parsedResults.flatMap((result) =>
      (result.data.calls ?? []).map((call) => {
        const proposal = resolveScopeResolverProposal(
          resolver,
          result.file,
          call,
        );
        return {
          file: result.file,
          call,
          proposal,
          sourceNodeKey: nodeKeyForSourceFunction(
            index,
            result.file,
            call.sourceFunction,
          ),
          targetNodeKey:
            proposal.status === "resolved"
              ? nodeKeyForResolverTarget(index, proposal.target)
              : null,
        };
      }),
    );
  }

  function callTargets(sourceNodeKey: string): string[] {
    const nodes = store.graph.getAllNodes();
    const sourceNode = nodes.find((node) => node.node_key === sourceNodeKey);
    if (!sourceNode) return [];
    const keysById = new Map(
      nodes.map((node) => [node.id, node.node_key] as const),
    );
    return store.graph
      .getOutgoingRelations(sourceNode.id)
      .filter((relation) => relation.linkType === LinkTypes.CALLS)
      .map((relation) => keysById.get(relation.id))
      .filter(
        (nodeKey): nodeKey is string =>
          nodeKey !== null && nodeKey !== undefined,
      )
      .sort();
  }

  it("[happy] replays worker-parsed imports, re-exports, members, same-file this calls, and the #561 factory against persisted targets", async () => {
    const parsedResults = await persistSources({
      "src/base.ts": [
        "export function baseRun() {}",
        "export class RemoteTask { static execute() {} }",
        "export const factory = () => ((value: number) => value);",
        "export const secondFactory = () => ((item: number) => item);",
      ].join("\n"),
      "src/barrel.ts": 'export { baseRun as runFromBarrel } from "./base";\n',
      "src/consumer.ts": [
        'import { runFromBarrel } from "./barrel";',
        'import { RemoteTask, factory } from "./base";',
        "export function callReexport() { runFromBarrel(); }",
        "export function callMember() { RemoteTask.execute(); }",
        "export function callFactory() { factory(1); }",
      ].join("\n"),
      "src/local.ts": [
        "class Alpha { run() {} invoke() { this.run(); } }",
        "class Beta { run() {} invoke() { this.run(); } }",
      ].join("\n"),
    });
    const replayed = replayCalls(parsedResults);
    const callsFor = (file: string, calleeName: string) =>
      replayed.filter(
        (site) => site.file === file && site.call.calleeName === calleeName,
      );
    const expectPersistedTarget = (
      file: string,
      calleeName: string,
      expectedTargetNodeKey: string,
    ) => {
      const site = callsFor(file, calleeName)[0];
      expect(site?.proposal.status).toBe("resolved");
      expect(site?.targetNodeKey).toBe(expectedTargetNodeKey);
      expect(site ? callTargets(site.sourceNodeKey) : []).toContain(
        expectedTargetNodeKey,
      );
    };

    const base = parsedResults.find((result) => result.file === "src/base.ts");
    expect(base?.data.functions?.map((fn) => fn.name)).toContain("factory");
    expect(base?.data.functions?.map((fn) => fn.name)).toContain("anonymous");
    const anonymousNodeKeys = store.graph
      .getAllNodes()
      .map((node) => node.node_key)
      .filter(
        (nodeKey): nodeKey is string =>
          nodeKey !== null && nodeKey.startsWith("src/base.ts#anonymous"),
      );
    expect(anonymousNodeKeys).toHaveLength(2);
    expect(new Set(anonymousNodeKeys).size).toBe(2);
    expectPersistedTarget(
      "src/consumer.ts",
      "runFromBarrel",
      "src/base.ts#baseRun",
    );
    expectPersistedTarget(
      "src/consumer.ts",
      "execute",
      "src/base.ts#RemoteTask.execute",
    );
    expectPersistedTarget("src/consumer.ts", "factory", "src/base.ts#factory");
    expect(callTargets("src/consumer.ts#callFactory")).not.toContain(
      "src/base.ts#anonymous",
    );

    // ScopeResolver sees only the name `run`, not the enclosing Alpha/Beta class. The two
    // per-site proposals therefore retain the existing same-file heuristic, while node_links
    // stores one aggregate `(source, target, calls)` relationship for the shared names.
    const sameFileThisCalls = callsFor("src/local.ts", "run");
    expect(sameFileThisCalls).toHaveLength(2);
    expect(
      sameFileThisCalls.every((site) => site.call.calleeKind === "this"),
    ).toBe(true);
    expect(
      new Set(sameFileThisCalls.map((site) => site.targetNodeKey)).size,
    ).toBe(1);
    for (const site of sameFileThisCalls) {
      expect(site.proposal.status).toBe("resolved");
      expect(site.targetNodeKey).not.toBeNull();
      expect(
        callTargets(site.sourceNodeKey).filter(
          (target) => target === site.targetNodeKey,
        ),
      ).toHaveLength(1);
    }
    expect(
      store.callSites
        .getForFiles(projectId, ["src/local.ts"])
        .get("src/local.ts"),
    ).toHaveLength(2);
  });

  it("[invalid-input] keeps an unsupported call-result member as a call-site row without inventing its target edge", async () => {
    const parsedResults = await persistSources({
      "src/unsupported.ts": [
        "function makeTask() { return { run() {} }; }",
        "export function invoke() { makeTask().run(); }",
      ].join("\n"),
    });
    const parsed = parsedResults[0]!;
    const unsupported = parsed.data.calls?.find(
      (call) => call.calleeName === "run",
    );

    expect(unsupported?.calleeKind).toBe("arg-chain");
    expect(
      store.callSites.getForFiles(projectId, [parsed.file]).get(parsed.file),
    ).toHaveLength(parsed.data.calls?.length ?? 0);
    expect(callTargets("src/unsupported.ts#invoke")).not.toContain(
      "src/unsupported.ts#run",
    );
  });

  it("[error-handling] retains an unresolved relative-import call site and creates no target edge", async () => {
    const parsedResults = await persistSources({
      "src/unresolved.ts": [
        'import { missingTask } from "./does-not-exist";',
        "export function invoke() { missingTask(); }",
      ].join("\n"),
    });
    const parsed = parsedResults[0]!;

    expect(parsed.data.calls).toHaveLength(1);
    expect(
      store.callSites.getForFiles(projectId, [parsed.file]).get(parsed.file),
    ).toHaveLength(1);
    expect(callTargets("src/unresolved.ts#invoke")).toEqual([]);
  });

  it("[stress] persists every repeated call site while node_links keeps the unique active edge", async () => {
    const repeatedCalls = Array.from({ length: 64 }, () => "target();").join(
      "\n",
    );
    const parsedResults = await persistSources({
      "src/stress.ts": [
        "function target() {}",
        `export function stressCaller() {\n${repeatedCalls}\n}`,
      ].join("\n"),
    });
    const parsed = parsedResults[0]!;
    const storedSites = store.callSites
      .getForFiles(projectId, [parsed.file])
      .get(parsed.file);

    expect(parsed.data.calls).toHaveLength(64);
    expect(storedSites).toHaveLength(64);
    expect(callTargets("src/stress.ts#stressCaller")).toEqual([
      "src/stress.ts#target",
    ]);
  });

  it("[state-diff] removes the old call target after a full-batch worker reparse", async () => {
    const initial: Sources = {
      "src/targets.ts":
        "export function alpha() {}\nexport function beta() {}\n",
      "src/caller.ts": [
        'import { alpha, beta } from "./targets";',
        "export function invoke() { alpha(); }",
      ].join("\n"),
    };
    await persistSources(initial);
    expect(callTargets("src/caller.ts#invoke")).toEqual([
      "src/targets.ts#alpha",
    ]);

    // Match production's GraphPersister contract: the resolver sees the entire current parse
    // batch, and each changed file is replaced in the same persistence transaction.
    const updated: Sources = {
      ...initial,
      "src/caller.ts": initial["src/caller.ts"]!.replace("alpha();", "beta();"),
    };
    const reparsed = await persistSources(updated);

    expect(callTargets("src/caller.ts#invoke")).toEqual([
      "src/targets.ts#beta",
    ]);
    const updatedCallSites = store.callSites
      .getForFiles(projectId, ["src/caller.ts"])
      .get("src/caller.ts");
    expect(updatedCallSites).toHaveLength(1);
    expect(updatedCallSites?.[0]?.targetFunction).toBe("beta");
    expect(reparsed).toHaveLength(2);
  });
});
