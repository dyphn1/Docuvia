import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ScopeResolver } from "../../lib/core/src/graph/scope-resolver.js";
import {
  classifyReceiver,
  buildParsedSymbolNodeKeyIndex,
  assertExactSampleCoverage,
  matchParsedCallAtPosition,
  nodeKeyForParsedDeclarationAtPosition,
  resolveScopeResolverProposal,
  summarizeBaselineRows,
  type BaselineCallRow,
  type ScopeResolverLike,
} from "../../scripts/semantic-corpus/phase0-tiered-call-resolution-replay.mts";

const call = (
  overrides: Partial<
    Parameters<typeof matchParsedCallAtPosition>[0][number]
  > = {},
) => ({
  sourceFunction: "caller",
  targetFunction: "store.commit",
  startLine: 3,
  startColumn: 8,
  calleeKind: "member" as const,
  calleeName: "commit",
  receiverText: "store",
  ...overrides,
});

describe("Phase 0 call-site baseline replay", () => {
  it("[happy] accepts an exact one-row-per-sample sidecar", () => {
    expect(() =>
      assertExactSampleCoverage("sidecar", new Set(["a", "b"]), [
        { sampleId: "b" },
        { sampleId: "a" },
      ]),
    ).not.toThrow();
  });

  it("[invalid-input] rejects duplicate, missing, and injected sample ids", () => {
    const expected = new Set(["a", "b"]);
    expect(() =>
      assertExactSampleCoverage("sidecar", expected, [
        { sampleId: "a" },
        { sampleId: "a" },
      ]),
    ).toThrow(/duplicate sample id/);
    expect(() =>
      assertExactSampleCoverage("sidecar", expected, [{ sampleId: "a" }]),
    ).toThrow(/exact expected sample-id set/);
    expect(() =>
      assertExactSampleCoverage("sidecar", expected, [
        { sampleId: "a" },
        { sampleId: "c" },
      ]),
    ).toThrow(/exact expected sample-id set/);
  });

  it("[happy] maps definition spans to distinct declarations with a fail-closed name collision", () => {
    const index = buildParsedSymbolNodeKeyIndex([
      {
        file: "src/targets.ts",
        data: {
          functions: [
            {
              name: "run",
              startLine: 0,
              endLine: 0,
              containerName: "First",
            },
            {
              name: "run",
              startLine: 0,
              endLine: 0,
              containerName: "Second",
            },
            { name: "overload", startLine: 2, endLine: 2 },
            { name: "overload", startLine: 4, endLine: 5 },
          ],
        },
      },
    ]);

    expect(
      nodeKeyForParsedDeclarationAtPosition(
        index,
        "src/targets.ts",
        "run",
        0,
        "Second",
      ),
    ).toEqual({
      status: "unique",
      nodeKey: "src/targets.ts#Second.run",
    });
    expect(
      nodeKeyForParsedDeclarationAtPosition(index, "src/targets.ts", "run", 0),
    ).toMatchObject({ status: "ambiguous" });
    expect(
      nodeKeyForParsedDeclarationAtPosition(
        index,
        "src/targets.ts",
        "overload",
        4,
      ),
    ).toEqual({ status: "unique", nodeKey: "src/targets.ts#overload@L4" });
  });

  it("[happy] maps an exact source position to the single parsed call row", () => {
    const first = call({ startColumn: 2, targetFunction: "cache.get" });
    const second = call({ startColumn: 8, targetFunction: "store.commit" });

    expect(matchParsedCallAtPosition([first, second], 3, 8)).toEqual({
      status: "unique",
      call: second,
    });
  });

  it("[error-handling] keeps zero and duplicate parser matches as explicit exclusions", () => {
    expect(matchParsedCallAtPosition([call()], 3, 9)).toEqual({
      status: "excluded",
      reason: "no-worker-call-at-position",
    });
    expect(matchParsedCallAtPosition([call(), call()], 3, 8)).toEqual({
      status: "excluded",
      reason: "multiple-worker-calls-at-position",
    });
  });

  it("[invalid-input] rejects non-integer or negative source coordinates", () => {
    expect(matchParsedCallAtPosition([call()], -1, 8)).toEqual({
      status: "excluded",
      reason: "invalid-position",
    });
    expect(matchParsedCallAtPosition([call()], 3, 1.5)).toEqual({
      status: "excluded",
      reason: "invalid-position",
    });
  });

  it("[happy] classifies receiver shapes and existing resolver binding clues", () => {
    const imports = [
      { localName: "store", originalName: "Store", modulePath: "./store" },
    ];
    const locals = new Set(["commit", "localStore"]);

    expect(
      classifyReceiver(
        call({ calleeKind: "this", receiverText: "this" }),
        imports,
        locals,
      ),
    ).toMatchObject({
      receiverCategory: "this",
      resolverRouteHint: "this-super",
    });
    expect(
      classifyReceiver(
        call({ calleeKind: "this", receiverText: "super" }),
        imports,
        locals,
      ),
    ).toMatchObject({
      receiverCategory: "super",
      resolverRouteHint: "this-super",
    });
    expect(classifyReceiver(call(), imports, locals)).toMatchObject({
      receiverCategory: "imported-identifier",
      resolverRouteHint: "import-binding-name-match",
    });
    expect(
      classifyReceiver(call({ receiverText: "localStore" }), imports, locals),
    ).toMatchObject({
      receiverCategory: "local-identifier",
      resolverRouteHint: "same-file-callee-name-available",
    });
    expect(
      classifyReceiver(call({ receiverText: "this.adapter" }), imports, locals),
    ).toMatchObject({ receiverCategory: "this-property-chain" });
    expect(
      classifyReceiver(
        call({ receiverText: "remote.client" }),
        imports,
        locals,
      ),
    ).toMatchObject({ receiverCategory: "member-property-chain" });
    expect(
      classifyReceiver(
        call({ calleeKind: "arg-chain", receiverText: "makeStore()" }),
        imports,
        locals,
      ),
    ).toMatchObject({
      receiverCategory: "call-result-chain",
      resolverRouteHint: "unsupported-shape",
    });
    expect(
      classifyReceiver(call({ calleeKind: "computed" }), imports, locals),
    ).toMatchObject({
      receiverCategory: "computed",
      resolverRouteHint: "unsupported-shape",
    });
  });

  it("[happy] replays production's member, bare, and unsupported call branches", () => {
    const resolveMemberCall = vi.fn(() => ({
      targetFile: "src/store.ts",
      targetSymbol: "commit",
    }));
    const resolveCall = vi.fn(() => ({
      targetFile: "src/util.ts",
      targetSymbol: "run",
    }));
    const resolver: ScopeResolverLike = { resolveMemberCall, resolveCall };

    expect(
      resolveScopeResolverProposal(resolver, "src/use.ts", call()),
    ).toEqual({
      status: "resolved",
      target: { targetFile: "src/store.ts", targetSymbol: "commit" },
      resolverPath: "member",
    });
    expect(
      resolveScopeResolverProposal(
        resolver,
        "src/use.ts",
        call({
          calleeKind: "bare",
          targetFunction: "run",
          calleeName: "run",
          receiverText: undefined,
        }),
      ),
    ).toMatchObject({ status: "resolved", resolverPath: "bare" });
    expect(
      resolveScopeResolverProposal(
        resolver,
        "src/use.ts",
        call({
          calleeKind: "arg-chain",
          receiverText: "factory()",
        }),
      ),
    ).toMatchObject({ status: "unsupported", target: null });
    expect(resolveMemberCall).toHaveBeenCalledTimes(1);
    expect(resolveCall).toHaveBeenCalledTimes(1);
  });

  it("[happy] queries real ScopeResolver bindings for imported members and same-file this calls", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-phase0-resolver-"),
    );
    try {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, "src/store.ts"),
        "export class Store { commit() {} }\n",
      );
      const resolver = new ScopeResolver(workspaceRoot);
      resolver.registerFile(
        "src/consumer.ts",
        [
          {
            localName: "store",
            originalName: "Store",
            modulePath: "./store",
          },
        ],
        [],
        [],
      );
      resolver.registerFile("src/store.ts", [], [], ["commit"]);
      resolver.registerFile("src/local.ts", [], [], ["commit"]);

      expect(
        resolveScopeResolverProposal(resolver, "src/consumer.ts", call()),
      ).toEqual({
        status: "resolved",
        target: { targetFile: "src/store.ts", targetSymbol: "commit" },
        resolverPath: "member",
      });
      expect(
        resolveScopeResolverProposal(
          resolver,
          "src/local.ts",
          call({
            calleeKind: "this",
            targetFunction: "this.commit",
            receiverText: "this",
          }),
        ),
      ).toEqual({
        status: "resolved",
        target: { targetFile: "src/local.ts", targetSymbol: "commit" },
        resolverPath: "member",
      });
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("[happy] computes candidate recall and resolver top-1 without dropping excluded rows", () => {
    const rows: BaselineCallRow[] = [
      {
        sampleId: "hit",
        repoFamily: "a",
        split: "train",
        duplicateGroup: "g1",
        callShape: "member",
        positionStatus: "unique",
        scopeResolverStatus: "resolved",
        resolverTargetId: "target-a",
      },
      {
        sampleId: "miss",
        repoFamily: "b",
        split: "test",
        duplicateGroup: "g2",
        callShape: "bare",
        positionStatus: "unique",
        scopeResolverStatus: "unresolved",
        resolverTargetId: null,
      },
      {
        sampleId: "excluded",
        repoFamily: "a",
        split: "train",
        duplicateGroup: "g3",
        callShape: "member",
        positionStatus: "excluded",
        scopeResolverStatus: "not-run",
        resolverTargetId: null,
      },
      {
        sampleId: "unlabeled",
        repoFamily: "b",
        split: "test",
        duplicateGroup: "g4",
        callShape: "this",
        positionStatus: "unique",
        scopeResolverStatus: "resolved",
        resolverTargetId: "unlabeled-target",
      },
    ];

    const summary = summarizeBaselineRows(
      rows,
      new Map([
        [
          "hit",
          { candidateTargetIds: ["target-a"], positiveTargetIds: ["target-a"] },
        ],
        ["miss", { candidateTargetIds: [], positiveTargetIds: ["target-b"] }],
        [
          "excluded",
          { candidateTargetIds: [], positiveTargetIds: ["target-c"] },
        ],
      ]),
    );

    expect(summary).toMatchObject({
      sourceRows: 4,
      mappedRows: 3,
      excludedRows: 1,
      goldRows: 3,
      candidateCoveredRows: 1,
      resolverCorrectRows: 1,
      resolverResolvedRows: 2,
      resolverLabeledResolvedRows: 1,
      resolverPrecisionWhenResolved: 1,
    });
    expect(summary.bySplit.test).toMatchObject({
      sourceRows: 2,
      resolverResolvedRows: 1,
    });
    expect(summary.byFamily.a).toMatchObject({
      sourceRows: 2,
      excludedRows: 1,
    });
    expect(summary.byCallShape.member).toMatchObject({
      sourceRows: 2,
      excludedRows: 1,
    });
  });
});
