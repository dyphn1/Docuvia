import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  type ParsedAstFileResult,
} from "@workspace/contracts";
import { AstWorkerPool } from "../ast/ast-worker-pool.js";
import type { AstParseResponse } from "../ast/ast-worker.js";
import { buildQualifiedBaseKey, buildUniqueNodeKey } from "./node-key.js";
import { CallResolutionHypothesisService } from "../semantic/call-resolution-hypothesis.service.js";
import {
  collectStrictCallSiteProofs,
  createFunctionNodeReference,
  portableCallSiteKeyForCall,
  type FunctionNodeReference,
} from "./call-resolution-graph-projection.js";

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

async function parseFile(
  file: string,
  code: string,
): Promise<ParsedAstFileResult> {
  const data = parseData(
    await pool.parse({
      filePath: file,
      language: SUPPORTED_LANGUAGES.TYPESCRIPT,
      code,
    }),
  );
  return {
    file,
    hash: createHash("sha256").update(code).digest("hex"),
    sourceContentHash: createHash("sha256").update(code).digest("hex"),
    data,
  };
}

function functionNodes(result: ParsedAstFileResult): FunctionNodeReference[] {
  const usedNodeKeys = new Set([result.file]);
  return (result.data.functions ?? []).map((fn) => {
    const nodeKey = buildUniqueNodeKey(
      usedNodeKeys,
      buildQualifiedBaseKey(result.file, fn.name, fn.containerName),
      fn.startLine,
    );
    usedNodeKeys.add(nodeKey);
    return createFunctionNodeReference(result, fn, nodeKey);
  });
}

async function fixture() {
  const target = await parseFile(
    "src/target.ts",
    [
      "export interface ParsedModel { toSdkModelId(): string; }",
      "export function toSdkModelId(model: string): string;",
      "export function toSdkModelId(model: undefined): undefined;",
      "export function toSdkModelId(model: string | undefined): string | undefined { return model; }",
      "function makeResult(model: string) { return { toSdkModelId: () => model }; }",
    ].join("\n"),
  );
  const caller = await parseFile(
    "src/caller.ts",
    [
      'import { toSdkModelId } from "./target.js";',
      "export function select(model: string) { return toSdkModelId(model); }",
    ].join("\n"),
  );
  const service = new CallResolutionHypothesisService();
  const workspaceIndex = service.indexWorkspace({
    sourceFingerprint: "f".repeat(64),
    sourceIndexComplete: true,
    sourceFiles: [target, caller].map((result) => ({
      filePath: result.file,
      sourceContentHash: result.sourceContentHash!,
      imports: result.data.imports,
      exports: result.data.exports,
      reexports: result.data.reexports,
      callSiteShapeFacts: result.data.callSiteShapeFacts ?? null,
      declaredTypeFacts: result.data.declaredTypeFacts ?? null,
    })),
  });
  const callShape = caller.data.callSiteShapeFacts?.callSites[0];
  if (!callShape) throw new Error("parser omitted call-site shape");
  const directHypothesis = service.hypothesize({
    callerFilePath: caller.file,
    callerSourceContentHash: caller.sourceContentHash!,
    callSite: callShape,
    workspaceIndex,
  });
  const proofCall = caller.data.calls?.find(
    (call) => call.calleeName === "toSdkModelId",
  );
  if (!proofCall) throw new Error("parser omitted imported call");
  return {
    target,
    caller,
    service,
    workspaceIndex,
    directHypothesis,
    call: proofCall,
    targetNodes: functionNodes(target),
    callerNodes: functionNodes(caller),
  };
}

describe("call resolution graph projection target mapping", () => {
  it("[happy] selects the exported overload implementation over a later object property", async () => {
    const data = await fixture();
    expect(data.directHypothesis.strictProof).toMatchObject({
      status: "proven",
      ruleSignature: "q1:named-import:v1",
    });
    const duplicatedCallerNodes = [
      ...data.callerNodes,
      ...data.callerNodes.map((node) => ({
        ...node,
        nodeKey: `${node.nodeKey}#ambiguous-caller-copy`,
      })),
    ];
    const collection = collectStrictCallSiteProofs({
      service: data.service,
      workspaceIndex: data.workspaceIndex,
      result: data.caller,
      functionNodes: duplicatedCallerNodes,
      functionNodesByFile: new Map([
        [data.caller.file, duplicatedCallerNodes],
        [data.target.file, data.targetNodes],
      ]),
    });
    expect(collection.exclusions).toEqual([]);
    expect(collection.proofs).toHaveLength(1);
    expect(collection.proofs[0]?.resolution.selectedTargetNodeKey).toBe(
      "src/target.ts#toSdkModelId",
    );
    expect(collection.proofs[0]?.resolution.callerNodeKey).toBe(
      "src/caller.ts",
    );
    expect(collection.exclusions).toEqual([]);
  });

  it("[boundary] excludes and counts multiple graph nodes for one proof declaration", async () => {
    const data = await fixture();
    const exported = data.targetNodes.find(
      (node) => node.name === "toSdkModelId",
    );
    if (!exported) throw new Error("parser omitted exported implementation");
    const ambiguousTargetNodes = [
      ...data.targetNodes,
      { ...exported, nodeKey: "src/target.ts#toSdkModelId@L999" },
    ];
    const collection = collectStrictCallSiteProofs({
      service: data.service,
      workspaceIndex: data.workspaceIndex,
      result: data.caller,
      functionNodes: data.callerNodes,
      functionNodesByFile: new Map([
        [data.caller.file, data.callerNodes],
        [data.target.file, ambiguousTargetNodes],
      ]),
    });

    expect(collection.proofs).toEqual([]);
    expect(collection.exclusions).toEqual([
      {
        callSiteKey: portableCallSiteKeyForCall(data.caller, data.call),
        filePath: "src/caller.ts",
        ruleSignature: "q1:named-import:v1",
        reason: "ambiguous-target-declaration-node",
        count: 1,
      },
    ]);
  });
});
