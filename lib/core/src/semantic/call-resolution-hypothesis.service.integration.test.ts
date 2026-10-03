import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  DocuviaFactory,
  ErrorCodes,
  SUPPORTED_LANGUAGES,
  TOKENS,
  type CallResolutionCalibrationRecord,
} from "@workspace/contracts";
import { clopperPearsonLowerBound } from "./system1/eval/system1-eval-calibration.js";
import { AstWorkerPool } from "../ast/ast-worker-pool.js";
import type { AstParseResponse } from "../ast/ast-worker.js";
import { registerCoreProviders } from "../register.js";
import { CallResolutionHypothesisService } from "./call-resolution-hypothesis.service.js";

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

async function parseFile(filePath: string, code: string) {
  return parseData(
    await pool.parse({
      filePath,
      language: SUPPORTED_LANGUAGES.TYPESCRIPT,
      code,
    }),
  );
}

function indexWorkspace(
  service: CallResolutionHypothesisService,
  sourceFingerprint: string,
  sourceFiles: readonly {
    filePath: string;
    sourceContentHash?: string;
    callSiteShapeFacts?: NonNullable<
      Awaited<ReturnType<typeof parseFile>>["callSiteShapeFacts"]
    > | null;
    declaredTypeFacts: NonNullable<
      Awaited<ReturnType<typeof parseFile>>["declaredTypeFacts"]
    > | null;
  }[],
  sourceIndexComplete = true,
) {
  return service.indexWorkspace({
    sourceFingerprint,
    sourceIndexComplete,
    sourceFiles,
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function makeCalibrationRecord(
  result: CallResolutionHypothesisResultLike,
  overrides: Partial<
    Omit<CallResolutionCalibrationRecord, "calibrationRecordHash">
  > = {},
): CallResolutionCalibrationRecord {
  const independentGroupCount = 100;
  const correctGroupCount = 100;
  const payload = {
    schemaVersion: 1 as const,
    split: "calibration" as const,
    ruleSignature: result.ruleSignature,
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    configurationHash: result.configurationHash,
    calibrationInputFingerprint: "1".repeat(64),
    thresholdScore: 0,
    independentGroupCount,
    correctGroupCount,
    confidenceLowerBound: clopperPearsonLowerBound(
      correctGroupCount,
      independentGroupCount,
    ),
    minimumIndependentGroups: 100,
    minimumConfidenceLowerBound: 0.9,
    targetFamilyMacroTop1: 0.9,
    familyMetrics: [
      { family: "seen-family", eligibleSiteCount: 100, top1Accuracy: 1 },
    ],
    ...overrides,
  };
  const calibrationRecordHash = createSha256(canonical(payload));
  return { ...payload, calibrationRecordHash };
}

function createSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type CallResolutionHypothesisResultLike = ReturnType<
  CallResolutionHypothesisService["hypothesize"]
>;

describe("call-resolution hypothesis service", () => {
  it("[happy] proves a complete, unique member declared on the exact this owner", async () => {
    const code =
      "class Service { close(): void {} call(): void { this.close(); } }";
    const callerFile = await parseFile("src/service.ts", code);
    const callSite = callerFile.callSiteShapeFacts?.callSites.find(
      (call) => call.calleeName === "close",
    );
    if (!callSite) throw new Error("worker omitted the this call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "0".repeat(64), [
      {
        filePath: "src/service.ts",
        sourceContentHash: createSha256(code),
        callSiteShapeFacts: callerFile.callSiteShapeFacts!,
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);

    const result = service.hypothesize({
      callerFilePath: "src/service.ts",
      callSite,
      callerSourceContentHash: createSha256(code),
      workspaceIndex,
    });

    expect(result.strictProof).toMatchObject({
      status: "proven",
      ruleSignature: "single-candidate-this-v1",
      targetKey: expect.any(String),
      reason: "unique-this-owner-member",
    });
    expect(result.strictProof.targetKey).toBe(result.candidates[0]?.targetKey);
  });

  it("[error-handling] abstains for this calls inside static methods", async () => {
    const code =
      "class Service { close(): void {} static call(): void { this.close(); } }";
    const callerFile = await parseFile("src/service.ts", code);
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    if (!callSite) throw new Error("worker omitted the static this call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "d".repeat(64), [
      {
        filePath: "src/service.ts",
        sourceContentHash: createSha256(code),
        callSiteShapeFacts: callerFile.callSiteShapeFacts!,
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);

    const result = service.hypothesize({
      callerFilePath: "src/service.ts",
      callerSourceContentHash: createSha256(code),
      callSite,
      workspaceIndex,
    });

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "unsupported-call-shape",
    });
  });

  it("[state-diff] abstains when the caller shape and indexed source hashes differ", async () => {
    const previousCode =
      "class Service { reset(): void {} close(): void {} call(): void { this.reset(); } }";
    const currentCode =
      "class Service { reset(): void {} close(): void {} call(): void { this.close(); } }";
    expect(previousCode).toHaveLength(currentCode.length);
    const previousFile = await parseFile("src/service.ts", previousCode);
    const currentFile = await parseFile("src/service.ts", currentCode);
    const staleCallSite = previousFile.callSiteShapeFacts?.callSites.find(
      (call) => call.calleeName === "reset",
    );
    if (!staleCallSite)
      throw new Error("worker omitted the previous call shape");
    const sourceFile = {
      filePath: "src/service.ts",
      declaredTypeFacts: currentFile.declaredTypeFacts!,
      sourceContentHash: createSha256(currentCode),
    };
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = service.indexWorkspace({
      sourceFingerprint: "a".repeat(64),
      sourceIndexComplete: true,
      sourceFiles: [sourceFile],
    });
    const request = {
      callerFilePath: "src/service.ts",
      callSite: staleCallSite,
      callerSourceContentHash: createSha256(previousCode),
      workspaceIndex,
    };

    const result = service.hypothesize(request);

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "source-snapshot-mismatch",
    });
  });

  it("[error-handling] abstains when a stale call-site fact is paired with the current hash", async () => {
    const previousCode =
      "class Service { reset(): void {} close(): void {} call(): void { this.reset(); } }";
    const currentCode =
      "class Service { reset(): void {} close(): void {} call(): void { this.close(); } }";
    const previousFile = await parseFile("src/service.ts", previousCode);
    const currentFile = await parseFile("src/service.ts", currentCode);
    const staleCallSite = previousFile.callSiteShapeFacts?.callSites.find(
      (call) => call.calleeName === "reset",
    );
    if (!staleCallSite)
      throw new Error("worker omitted the previous call shape");
    const sourceFile = {
      filePath: "src/service.ts",
      declaredTypeFacts: currentFile.declaredTypeFacts!,
      callSiteShapeFacts: currentFile.callSiteShapeFacts!,
      sourceContentHash: createSha256(currentCode),
    };
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = service.indexWorkspace({
      sourceFingerprint: "b".repeat(64),
      sourceIndexComplete: true,
      sourceFiles: [sourceFile],
    });
    const request = {
      callerFilePath: "src/service.ts",
      callSite: staleCallSite,
      callerSourceContentHash: createSha256(currentCode),
      workspaceIndex,
    };

    const result = service.hypothesize(request);

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "call-site-not-in-indexed-source",
    });
  });

  it("[invalid-input] abstains when the indexed caller file has no source hash", async () => {
    const code =
      "class Service { close(): void {} call(): void { this.close(); } }";
    const callerFile = await parseFile("src/service.ts", code);
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    if (!callSite) throw new Error("worker omitted the this call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "c".repeat(64), [
      {
        filePath: "src/service.ts",
        callSiteShapeFacts: callerFile.callSiteShapeFacts!,
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);

    const result = service.hypothesize({
      callerFilePath: "src/service.ts",
      callerSourceContentHash: createSha256(code),
      callSite,
      workspaceIndex,
    });

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "source-snapshot-unbound",
    });
  });

  it("[invalid-input] abstains from strict proof when the workspace inventory is incomplete", async () => {
    const callerFile = await parseFile(
      "src/service.ts",
      "class Service { close(): void {} call(): void { this.close(); } }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites.find(
      (call) => call.calleeName === "close",
    );
    if (!callSite) throw new Error("worker omitted the this call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(
      service,
      "1".repeat(64),
      [
        {
          filePath: "src/service.ts",
          declaredTypeFacts: callerFile.declaredTypeFacts!,
        },
      ],
      false,
    );

    const result = service.hypothesize({
      callerFilePath: "src/service.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "incomplete-inventory",
    });
  });

  it("[state-diff] abstains when the bounded candidate list is truncated", async () => {
    const callerFile = await parseFile(
      "src/service.ts",
      "class Service { close(): void {} call(): void { this.close(); } }",
    );
    const otherFile = await parseFile(
      "src/other.ts",
      "class Other { close(): void {} }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites.find(
      (call) => call.calleeName === "close",
    );
    if (!callSite) throw new Error("worker omitted the this call shape");
    const service = new CallResolutionHypothesisService({ maxCandidates: 1 });
    const workspaceIndex = indexWorkspace(service, "2".repeat(64), [
      {
        filePath: "src/service.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
      {
        filePath: "src/other.ts",
        declaredTypeFacts: otherFile.declaredTypeFacts!,
      },
    ]);

    const result = service.hypothesize({
      callerFilePath: "src/service.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.truncated).toBe(true);
    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "candidate-list-truncated",
    });
  });

  it("[error-handling] abstains for member calls whose receiver binding is not direct this", async () => {
    const serviceFile = await parseFile(
      "src/service.ts",
      "class Service { close(): void {} }",
    );
    const otherFile = await parseFile(
      "src/other.ts",
      "class Other { close(): void {} }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(service: Service) { service.close(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    if (!callSite) throw new Error("worker omitted the member call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "3".repeat(64), [
      {
        filePath: "src/service.ts",
        declaredTypeFacts: serviceFile.declaredTypeFacts!,
      },
      {
        filePath: "src/other.ts",
        declaredTypeFacts: otherFile.declaredTypeFacts!,
      },
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);

    const result = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason: "unsupported-call-shape",
    });
  });

  it("[happy] indexes once and applies typed receiver, peer, and arity evidence in order", async () => {
    const serviceFile = await parseFile(
      "src/service.ts",
      "export class Service { close(): void {} open(value: string): void {} }",
    );
    const otherFile = await parseFile(
      "src/other.ts",
      "export class Service { close(): void {} open(value: number, second: number): void {} }",
    );
    const incompletePeerFile = await parseFile(
      "src/service-alt.ts",
      "export class Service { open(value: string): void {} }",
    );
    const unrelatedFile = await parseFile(
      "src/unrelated.ts",
      "export class Other { open(value: number): void {} }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      [
        "function run(service: Service) {",
        "  service.close();",
        '  service.open("value");',
        "}",
      ].join("\n"),
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites.find(
      (call) => call.calleeName === "open",
    );
    expect(callSite?.peerMemberNames).toContain("close");
    if (!callSite) throw new Error("worker omitted the open call shape");

    const factory = new DocuviaFactory();
    registerCoreProviders(factory);
    const service = factory.resolve(TOKENS.CallResolutionHypothesisService);
    const workspaceIndex = service.indexWorkspace({
      sourceFingerprint: "a".repeat(64),
      sourceIndexComplete: true,
      sourceFiles: [
        {
          filePath: "src/service.ts",
          declaredTypeFacts: serviceFile.declaredTypeFacts!,
        },
        {
          filePath: "src/other.ts",
          declaredTypeFacts: otherFile.declaredTypeFacts!,
        },
        {
          filePath: "src/service-alt.ts",
          declaredTypeFacts: incompletePeerFile.declaredTypeFacts!,
        },
        {
          filePath: "src/unrelated.ts",
          declaredTypeFacts: unrelatedFile.declaredTypeFacts!,
        },
        {
          filePath: "src/caller.ts",
          declaredTypeFacts: callerFile.declaredTypeFacts!,
        },
      ],
    });
    const result = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.generatedCandidateKeys).toHaveLength(4);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.filePath).toBe("src/service.ts");
    expect(result.filterStages).toMatchObject({
      explicitReceiverType: { inputCount: 4, outputCount: 3, applied: true },
      peerMembers: { inputCount: 3, outputCount: 2, applied: true },
      argumentShape: { inputCount: 2, outputCount: 1, applied: true },
    });
    expect(result.status).toBe("ambiguous");
    expect(result.selected).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.reason).toBe("uncalibrated-signature");
  });

  it("[invalid-input] preserves recall proposals but fails closed for incomplete inventories", async () => {
    expect(
      () =>
        new CallResolutionHypothesisService({
          minimumConfidenceLowerBound: Number.NaN,
        }),
    ).toThrowError(
      expect.objectContaining({ code: ErrorCodes.SEMANTIC_INVALID_REQUEST }),
    );
    const knownFile = await parseFile(
      "src/known.ts",
      "export class Known { open(): void {} }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(service: Missing) { service.open(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    expect(callSite).toBeDefined();
    if (!callSite) throw new Error("worker omitted the call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(
      service,
      "b".repeat(64),
      [
        {
          filePath: "src/known.ts",
          declaredTypeFacts: knownFile.declaredTypeFacts!,
        },
        {
          filePath: "src/caller.ts",
          declaredTypeFacts: callerFile.declaredTypeFacts!,
        },
      ],
      false,
    );
    const result = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.generatedCandidateKeys).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidateSetComplete).toBe(false);
    expect(result.status).toBe("ambiguous");
    expect(result.selected).toBeNull();
    expect(result.reason).toBe("incomplete-inventory");
  });

  it("[error-handling] rejects private members outside their declaring type", async () => {
    const privateFile = await parseFile(
      "src/private.ts",
      "export class PrivateService { private open(): void {} }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(service: PrivateService) { service.open(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    expect(callSite).toBeDefined();
    if (!callSite) throw new Error("worker omitted the call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "c".repeat(64), [
      {
        filePath: "src/private.ts",
        declaredTypeFacts: privateFile.declaredTypeFacts!,
      },
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);
    const result = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.generatedCandidateKeys).toHaveLength(1);
    expect(result.candidates).toHaveLength(0);
    expect(result.filterStages.visibility).toMatchObject({
      applied: true,
      outputCount: 0,
    });
    expect(result.status).toBe("ambiguous");
    expect(result.reason).toBe("no-supported-candidates");
  });

  it("[stress] truncates display proposals without truncating recall candidates", async () => {
    const parsed = await Promise.all(
      ["Alpha", "Beta", "Gamma"].map((name) =>
        parseFile(`src/${name}.ts`, `export class ${name} { open(): void {} }`),
      ),
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(service: unknown) { service.open(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    expect(callSite).toBeDefined();
    if (!callSite) throw new Error("worker omitted the call shape");
    const service = new CallResolutionHypothesisService({ maxCandidates: 1 });
    const workspaceIndex = indexWorkspace(service, "d".repeat(64), [
      ...parsed.map((file, index) => ({
        filePath: `src/${["Alpha", "Beta", "Gamma"][index]}.ts`,
        declaredTypeFacts: file.declaredTypeFacts!,
      })),
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);
    const result = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.generatedCandidateKeys).toHaveLength(3);
    expect(result.candidates).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.selected).toBeNull();
    expect(result.reason).toBe("candidate-list-truncated");
  });

  it("[state-diff] separates per-site feature hashes from reusable rule patterns", async () => {
    const source = await parseFile(
      "src/caller.ts",
      "function run(service: Service) { service.open(); }",
    );
    const changed = await parseFile(
      "src/caller.ts",
      "function run(service: Other) { service.open(); }",
    );
    const firstCall = source.callSiteShapeFacts?.callSites[0];
    const changedCall = changed.callSiteShapeFacts?.callSites[0];
    expect(firstCall).toBeDefined();
    expect(changedCall).toBeDefined();
    if (!firstCall || !changedCall)
      throw new Error("worker omitted a call shape");
    const service = new CallResolutionHypothesisService();
    const firstIndex = indexWorkspace(service, "e".repeat(64), [
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: source.declaredTypeFacts!,
      },
    ]);
    const changedIndex = indexWorkspace(service, "e".repeat(64), [
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: changed.declaredTypeFacts!,
      },
    ]);
    const firstResult = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite: firstCall,
      workspaceIndex: firstIndex,
    });
    const changedResult = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite: changedCall,
      workspaceIndex: changedIndex,
    });

    expect(firstResult.featureInputHash).not.toBe(
      changedResult.featureInputHash,
    );
    expect(firstResult.ruleSignature).toBe(changedResult.ruleSignature);
    expect(firstResult.configurationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(firstResult.sourceFingerprint).not.toBe(
      changedResult.sourceFingerprint,
    );
    expect(firstResult.status).toBe("ambiguous");
    expect(changedResult.status).toBe("ambiguous");
  });

  it("[state-diff] snapshots indexed facts and rejects a handle from another service", async () => {
    const targetFile = await parseFile(
      "src/target.ts",
      "export class Target { open(): void {} }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(target: Target) { target.open(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    expect(callSite).toBeDefined();
    if (!callSite) throw new Error("worker omitted the call shape");
    const files = [
      {
        filePath: "src/target.ts",
        declaredTypeFacts: targetFile.declaredTypeFacts!,
      },
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ];
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "f".repeat(64), files);
    const before = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });
    (targetFile.declaredTypeFacts!.facts as unknown[]).push({
      malformed: true,
    });
    files.push({
      filePath: "src/injected.ts",
      declaredTypeFacts: targetFile.declaredTypeFacts!,
    });
    const after = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(after.featureInputHash).toBe(before.featureInputHash);
    expect(after.generatedCandidateKeys).toEqual(before.generatedCandidateKeys);
    expect(() =>
      new CallResolutionHypothesisService().hypothesize({
        callerFilePath: "src/caller.ts",
        callSite,
        workspaceIndex,
      }),
    ).toThrowError(
      expect.objectContaining({ code: ErrorCodes.SEMANTIC_INVALID_REQUEST }),
    );
  });

  it("[positive] accepts a hash-valid calibration record that meets support and macro gates", async () => {
    const targetFile = await parseFile(
      "src/target.ts",
      "export class Target { open(): void {} }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(target: Target) { target.open(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    expect(callSite).toBeDefined();
    if (!callSite) throw new Error("worker omitted the call shape");
    const files = [
      {
        filePath: "src/target.ts",
        declaredTypeFacts: targetFile.declaredTypeFacts!,
      },
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ];
    const calibrationBuilder = new CallResolutionHypothesisService();
    const builderIndex = indexWorkspace(
      calibrationBuilder,
      "1".repeat(64),
      files,
    );
    const baseline = calibrationBuilder.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex: builderIndex,
    });
    const record = makeCalibrationRecord(baseline);
    const service = new CallResolutionHypothesisService({
      calibrationRecords: [record],
    });
    const workspaceIndex = indexWorkspace(service, "1".repeat(64), files);
    const result = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.status).toBe("likely");
    expect(result.selected?.owner.name).toBe("Target");
    expect(result.confidence).toBe(record.confidenceLowerBound);
    expect(Number.isFinite(result.confidence)).toBe(true);
    expect(result.reason).toBe("calibrated-likely");
  });

  it("[negative] rejects bad calibration hash, support, macro, ties, truncation, and incomplete input", async () => {
    const targetFile = await parseFile(
      "src/target.ts",
      "export class Target { open(): void {} }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(target: Target) { target.open(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    expect(callSite).toBeDefined();
    if (!callSite) throw new Error("worker omitted the call shape");
    const oneCandidateFiles = [
      {
        filePath: "src/target.ts",
        declaredTypeFacts: targetFile.declaredTypeFacts!,
      },
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ];
    const baselineService = new CallResolutionHypothesisService();
    const baselineIndex = indexWorkspace(
      baselineService,
      "2".repeat(64),
      oneCandidateFiles,
    );
    const baseline = baselineService.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex: baselineIndex,
    });
    const valid = makeCalibrationRecord(baseline);
    const invalidCases = [
      {
        name: "tampered hash",
        record: { ...valid, calibrationRecordHash: "0".repeat(64) },
      },
      {
        name: "non-finite confidence",
        record: makeCalibrationRecord(baseline, {
          confidenceLowerBound: Number.NaN,
        }),
      },
      {
        name: "support mismatch",
        record: makeCalibrationRecord(baseline, {
          minimumIndependentGroups: 99,
        }),
      },
      {
        name: "family macro below target",
        record: makeCalibrationRecord(baseline, {
          familyMetrics: [
            {
              family: "seen-family",
              eligibleSiteCount: 100,
              top1Accuracy: 0.89,
            },
          ],
        }),
      },
    ];
    for (const invalidCase of invalidCases) {
      const service = new CallResolutionHypothesisService({
        calibrationRecords: [invalidCase.record],
      });
      const workspaceIndex = indexWorkspace(
        service,
        "2".repeat(64),
        oneCandidateFiles,
      );
      const result = service.hypothesize({
        callerFilePath: "src/caller.ts",
        callSite,
        workspaceIndex,
      });
      expect(result.status, invalidCase.name).toBe("ambiguous");
      expect(result.confidence, invalidCase.name).toBeNull();
      expect(result.reason, invalidCase.name).toBe("calibration-rejected");
    }

    const multipleFile = await parseFile(
      "src/other.ts",
      "export class Other { open(): void {} }",
    );
    const tieCallerFile = await parseFile(
      "src/tie-caller.ts",
      "function run(target: unknown) { target.open(); }",
    );
    const tieCallSite = tieCallerFile.callSiteShapeFacts?.callSites[0];
    expect(tieCallSite).toBeDefined();
    if (!tieCallSite) throw new Error("worker omitted the tie call shape");
    const tieFiles = [
      ...oneCandidateFiles,
      {
        filePath: "src/other.ts",
        declaredTypeFacts: multipleFile.declaredTypeFacts!,
      },
      {
        filePath: "src/tie-caller.ts",
        declaredTypeFacts: tieCallerFile.declaredTypeFacts!,
      },
    ];
    const tieBuilder = new CallResolutionHypothesisService();
    const tieBuilderIndex = indexWorkspace(
      tieBuilder,
      "3".repeat(64),
      tieFiles,
    );
    const tieBaseline = tieBuilder.hypothesize({
      callerFilePath: "src/tie-caller.ts",
      callSite: tieCallSite,
      workspaceIndex: tieBuilderIndex,
    });
    const tieService = new CallResolutionHypothesisService({
      calibrationRecords: [makeCalibrationRecord(tieBaseline)],
    });
    const tieIndex = indexWorkspace(tieService, "3".repeat(64), tieFiles);
    const tied = tieService.hypothesize({
      callerFilePath: "src/tie-caller.ts",
      callSite: tieCallSite,
      workspaceIndex: tieIndex,
    });
    expect(tied.status).toBe("ambiguous");
    expect(tied.selected).toBeNull();
    expect(tied.reason).toBe("calibration-rejected");

    const truncationBuilder = new CallResolutionHypothesisService({
      maxCandidates: 1,
    });
    const truncationBuilderIndex = indexWorkspace(
      truncationBuilder,
      "3".repeat(64),
      tieFiles,
    );
    const truncationBaseline = truncationBuilder.hypothesize({
      callerFilePath: "src/tie-caller.ts",
      callSite: tieCallSite,
      workspaceIndex: truncationBuilderIndex,
    });
    const truncationService = new CallResolutionHypothesisService({
      maxCandidates: 1,
      calibrationRecords: [makeCalibrationRecord(truncationBaseline)],
    });
    const truncationIndex = indexWorkspace(
      truncationService,
      "3".repeat(64),
      tieFiles,
    );
    const truncated = truncationService.hypothesize({
      callerFilePath: "src/tie-caller.ts",
      callSite: tieCallSite,
      workspaceIndex: truncationIndex,
    });
    expect(truncated.status).toBe("ambiguous");
    expect(truncated.reason).toBe("candidate-list-truncated");

    const incompleteService = new CallResolutionHypothesisService({
      calibrationRecords: [valid],
    });
    const incompleteIndex = indexWorkspace(
      incompleteService,
      "2".repeat(64),
      oneCandidateFiles,
      false,
    );
    const incomplete = incompleteService.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex: incompleteIndex,
    });
    expect(incomplete.status).toBe("ambiguous");
    expect(incomplete.confidence).toBeNull();
    expect(incomplete.reason).toBe("incomplete-inventory");
  });

  it("[identity] keeps static, instance, and same-name bare declarations distinct", async () => {
    const declarations = await parseFile(
      "src/declarations.ts",
      [
        "export class Service { open(): void {} static open(): void {} }",
        "export function open(): void;",
        "export function open(value: string): void;",
      ].join("\n"),
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(service: Service) { service.open(); open(); }",
    );
    const calls = callerFile.callSiteShapeFacts?.callSites;
    expect(calls).toBeDefined();
    if (!calls) throw new Error("worker omitted call shapes");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "4".repeat(64), [
      {
        filePath: "src/declarations.ts",
        declaredTypeFacts: declarations.declaredTypeFacts!,
      },
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);
    const memberCall = calls.find(({ calleeKind }) => calleeKind === "member");
    const bareCall = calls.find(({ calleeKind }) => calleeKind === "bare");
    expect(memberCall).toBeDefined();
    expect(bareCall).toBeDefined();
    if (!memberCall || !bareCall)
      throw new Error("worker omitted expected calls");
    const memberResult = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite: memberCall,
      workspaceIndex,
    });
    const bareResult = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite: bareCall,
      workspaceIndex,
    });

    expect(memberResult.generatedCandidateKeys).toHaveLength(2);
    expect(
      new Set(memberResult.candidates.map(({ isStatic }) => isStatic)),
    ).toEqual(new Set([false, true]));
    expect(bareResult.generatedCandidateKeys).toHaveLength(2);
    expect(new Set(bareResult.generatedCandidateKeys).size).toBe(2);
    expect(memberResult.status).toBe("ambiguous");
    expect(bareResult.status).toBe("ambiguous");
  });

  it("[identity] scopes heritage evidence to its source file and exact owner", async () => {
    const implemented = await parseFile(
      "src/implemented.ts",
      "export class Same implements Contract { open(): void {} }",
    );
    const unrelated = await parseFile(
      "src/unrelated.ts",
      "export class Same { open(): void {} }",
    );
    const contract = await parseFile(
      "src/contract.ts",
      "export interface Contract { open(): void }",
    );
    const callerFile = await parseFile(
      "src/caller.ts",
      "function run(value: Contract) { value.open(); }",
    );
    const callSite = callerFile.callSiteShapeFacts?.callSites[0];
    expect(callSite).toBeDefined();
    if (!callSite) throw new Error("worker omitted the call shape");
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = indexWorkspace(service, "5".repeat(64), [
      {
        filePath: "src/implemented.ts",
        declaredTypeFacts: implemented.declaredTypeFacts!,
      },
      {
        filePath: "src/unrelated.ts",
        declaredTypeFacts: unrelated.declaredTypeFacts!,
      },
      {
        filePath: "src/contract.ts",
        declaredTypeFacts: contract.declaredTypeFacts!,
      },
      {
        filePath: "src/caller.ts",
        declaredTypeFacts: callerFile.declaredTypeFacts!,
      },
    ]);
    const result = service.hypothesize({
      callerFilePath: "src/caller.ts",
      callSite,
      workspaceIndex,
    });

    expect(result.filterStages.explicitReceiverType.outputCount).toBe(2);
    expect(result.candidates.map(({ filePath }) => filePath)).toContain(
      "src/implemented.ts",
    );
    expect(result.candidates.map(({ filePath }) => filePath)).toContain(
      "src/contract.ts",
    );
    expect(result.candidates.map(({ filePath }) => filePath)).not.toContain(
      "src/unrelated.ts",
    );
  });
});
