import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CALL_SITE_VERIFICATION_POLICY_VERSION,
  CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  createPortableCallSiteKey,
  type IGitProvider,
  type IGraphStore,
  type IKnowledgeGitService,
  type IEdgeResolutionProvider,
  type EdgeResolutionOutcome,
  type EdgeResolutionRequest,
  type NodeLinkRow,
  type CallSiteResolutionRecord,
  type CallSiteLspResolutionResult,
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  ANALYZE_LOG_FILE_NAME,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { runTierBBatch } from "./run-tier-b-batch.js";
import {
  appendTierBQueueEntries,
  readTierBQueue,
  removeTierBQueueEntriesForFiles,
} from "./tier-b-queue.js";
import {
  CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  loadCallResolutionCertificationArtifact,
  type CallResolutionCertificationArtifact,
} from "./call-resolution-certification.js";

const HEAD_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const CERTIFICATION_INPUTS = {
  implementationCommitSha: "a".repeat(40),
  ruleConfigurationSha256: "b".repeat(64),
  oracleIdentity: "typescript-language-server",
  oracleVersion: "5.9.2",
  oracleConfigurationSha256: "c".repeat(64),
  corpusManifestSha256: "d".repeat(64),
  newFamily: {
    familyId: "new-family-a",
    revision: "commit-new-family",
    splitSha256: "e".repeat(64),
  },
  temporal: {
    familyId: "nestjs",
    baseRevision: "commit-temporal-base",
    revision: "commit-temporal-newer",
    splitSha256: "f".repeat(64),
  },
};

function createBatchCertificationDecision(ruleSignature: string) {
  const passingTrack = {
    eligibleDuplicateGroups: 299,
    uniquelyResolvedGroups: 299,
    successfulGroups: 299,
    contradictionGroups: 0,
    lowerBound95: 0.05 ** (1 / 299),
  };
  const artifact: CallResolutionCertificationArtifact = {
    schemaVersion: CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
    policyVersion: CALL_SITE_VERIFICATION_POLICY_VERSION,
    frozenAt: "2026-01-01T00:00:00.000Z",
    labelsOpenedAt: "2026-01-02T00:00:00.000Z",
    resultsRecordedAt: "2026-01-03T00:00:00.000Z",
    inputs: CERTIFICATION_INPUTS,
    signatures: [
      {
        ruleSignature,
        newFamily: passingTrack,
        temporal: passingTrack,
      },
    ],
  };
  const rawArtifact = JSON.stringify(artifact);
  return loadCallResolutionCertificationArtifact(rawArtifact, {
    ...CERTIFICATION_INPUTS,
    artifactSha256: createHash("sha256").update(rawArtifact).digest("hex"),
  });
}

function makeGit(overrides: Partial<IGitProvider> = {}): IGitProvider {
  return {
    getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
    getCommitAncestry: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IGitProvider;
}

function makeKnowledgeGit(): IKnowledgeGitService {
  return {
    runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    hasSourceCommitInHistory: vi.fn().mockResolvedValue(false),
  } as unknown as IKnowledgeGitService;
}

interface FakeStore {
  meta: Map<string, string>;
  links: NodeLinkRow[];
  nodeKeyToId: Map<string, number>;
  projectFileHashes: Array<{ filePath: string; contentHash: string | null }>;
  tierBProcessed: Array<{
    projectId: number;
    filePath: string;
    commitSha: string | null;
  }>;
}

function makeStore(
  nodeKeys: string[] = [],
  projectFileHashes: Array<{
    filePath: string;
    contentHash: string | null;
  }> = [],
): {
  store: IGraphStore;
  fake: FakeStore;
} {
  const fake: FakeStore = {
    meta: new Map(),
    links: [],
    nodeKeyToId: new Map(nodeKeys.map((key, i) => [key, i + 1])),
    projectFileHashes,
    tierBProcessed: [],
  };
  let nextLinkId = 1;

  const store = {
    projects: {
      getFirst: () => ({ id: 1 }),
    },
    // Issue #11 plan A, Slice 3: `buildCallsByFileForTypescript`'s first call on every TS-bucket
    // batch, before any of this file's own edge-application assertions are reached -- empty by
    // default so it short-circuits to `undefined` (no forward-seeding, no git calls), keeping
    // this file's existing tests scoped to the reverse-path behavior they were written to cover.
    // See `tier-b-edge-resolution-orchestrator.unit.test.ts` for the forward-seeding tests proper.
    callSites: {
      getForFiles: () => new Map(),
    },
    files: {
      getAllHashes: () => fake.projectFileHashes,
      markTierBProcessed: (input: {
        projectId: number;
        filePath: string;
        commitSha: string | null;
      }) => {
        fake.tierBProcessed.push(input);
      },
    },
    meta: {
      get: (key: string) => fake.meta.get(key),
      set: (key: string, value: string) => {
        fake.meta.set(key, value);
      },
    },
    graph: {
      getAllLinks: () => fake.links,
      findNodeIdByNodeKey: (key: string) => fake.nodeKeyToId.get(key),
      insertLink: (input: {
        sourceNodeId: number;
        targetNodeId: number;
        linkType: string;
      }) => {
        fake.links.push({
          id: nextLinkId++,
          source_node_id: input.sourceNodeId,
          target_node_id: input.targetNodeId,
          link_type: input.linkType as NodeLinkRow["link_type"],
          commit_sha: null,
          diff_summary: null,
          created_at: "",
        });
      },
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
      getExternalIncomingLinks: vi.fn().mockReturnValue([]),
    },
    withWriteLock: async (fn: () => unknown) => fn(),
    withTransaction: (fn: () => unknown) => fn(),
  } as unknown as IGraphStore;

  return { store, fake };
}

function makeProvider(
  checkAvailability: () => Promise<{ available: boolean; reason?: string }>,
  resolveEdges: (files: string[]) => Promise<EdgeResolutionOutcome>,
  name = "fake-provider",
): IEdgeResolutionProvider {
  return {
    name,
    configure: vi.fn(),
    checkAvailability,
    resolveEdges: (req) => resolveEdges(req.files),
  };
}

/** Registers `provider` as the sole `typescript` entry in the `EdgeResolutionProviders` registry
 *  (multi-language-lsp-support plan, Finding A) -- the shape every other test in this file that
 *  only cares about TS/JS's own behavior expects. */
function registerProvider(provider: IEdgeResolutionProvider): void {
  docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
    typescript: () => provider,
  }));
}

beforeEach(() => {
  resetFactoryForTests();
});

describe("runTierBBatch() (§8, D1-D6)", () => {
  it("[state-diff] sends zero-certified sites to Tier B in resolution-class priority order", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-class-priority-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "caller.ts"),
      "export function caller() {\n  proven();\n  likely();\n  unresolved();\n  ambiguous();\n}\n",
    );

    const sourceContentHash = "8".repeat(64);
    const filePath = "caller.ts";
    const callSites = [
      { targetFunction: "proven", startLine: 1, startColumn: 2 },
      { targetFunction: "likely", startLine: 2, startColumn: 2 },
      { targetFunction: "unresolved", startLine: 3, startColumn: 2 },
      { targetFunction: "ambiguous", startLine: 4, startColumn: 2 },
    ];
    const makeResolution = (
      startLine: number,
      calleeName: string,
      resolutionClass: CallSiteResolutionRecord["resolutionClass"],
    ): CallSiteResolutionRecord => ({
      callSiteKey: createPortableCallSiteKey({
        filePath,
        sourceContentHash,
        startLine,
        startColumn: 2,
        calleeKind: "bare",
        calleeName,
      }),
      identityVersion: 1,
      filePath,
      sourceContentHash,
      startLine,
      startColumn: 2,
      calleeKind: "bare",
      calleeName,
      callerNodeKey: "caller.ts#caller",
      resolutionClass,
      selectedTargetNodeKey:
        resolutionClass === "proven" || resolutionClass === "likely"
          ? `targets.ts#${calleeName}`
          : null,
      confidence: resolutionClass === "likely" ? 0.75 : null,
      resolver: "strict-proof",
      ruleSignature: `${resolutionClass}-rule-v1`,
      dependencyFingerprint: "9".repeat(64),
      dependencies: [],
      verificationStatus: "unverified",
      verifiedTargetNodeKey: null,
      isStale: false,
      candidates: [],
    });
    const resolutions = [
      makeResolution(1, "proven", "proven"),
      makeResolution(2, "likely", "likely"),
      makeResolution(3, "unresolved", "unresolved"),
      makeResolution(4, "ambiguous", "ambiguous"),
    ];
    const { store, fake } = makeStore(
      [],
      [{ filePath, contentHash: sourceContentHash }],
    );
    store.callSites.getForFiles = vi.fn(() => new Map([[filePath, callSites]]));
    Object.defineProperty(store, "callSiteResolutions", {
      value: {
        getForFile: vi.fn(() => resolutions),
      },
    });
    appendTierBQueueEntries(store, [{ file: filePath, commitSha: HEAD_SHA }]);

    let request: EdgeResolutionRequest | undefined;
    const provider: IEdgeResolutionProvider = {
      name: "class-priority-provider",
      configure: vi.fn(),
      checkAvailability: vi.fn(async () => ({ available: true })),
      resolveEdges: vi.fn(async (value) => {
        request = value;
        return {
          edges: [],
          filesProcessed: value.files,
          filesFailed: [],
        };
      }),
    };
    registerProvider(provider);

    try {
      const result = await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit({
          listTrackedFilesWithBlobHash: vi.fn(
            async () => new Map([[filePath, sourceContentHash]]),
          ),
          listUntrackedFiles: vi.fn(async () => []),
          listModifiedFiles: vi.fn(async () => []),
        }),
        knowledgeGit: makeKnowledgeGit(),
        callResolutionCanary: {
          certification: loadCallResolutionCertificationArtifact(
            undefined,
            undefined,
          ),
        },
      });

      expect(provider.resolveEdges).toHaveBeenCalledTimes(1);
      expect(request).toBeDefined();
      const receivedRequest = request!;
      const scheduledSites = receivedRequest.callsByFile?.[filePath] ?? [];
      expect(receivedRequest.files).toEqual([filePath]);
      expect(
        scheduledSites.map(({ targetFunction }) => targetFunction),
      ).toEqual(["unresolved", "ambiguous", "likely", "proven"]);
      expect(
        scheduledSites.map(({ verificationMode }) => verificationMode),
      ).toEqual(["tier-b", "tier-b", "tier-b", "tier-b"]);
      expect(
        scheduledSites.map(
          ({ expectedTargetNodeKey }) => expectedTargetNodeKey,
        ),
      ).toEqual([null, null, "targets.ts#likely", "targets.ts#proven"]);
      expect(receivedRequest.callResolutionCanary).toEqual({
        policyVersion: "sha256-callsite-rule-v2",
        sampleRate: 0.1,
        stratification: "rule-signature",
        hashInputFields: ["callSiteKey", "ruleSignature"],
        selectedCallSiteKeysByRuleSignature: {},
        ruleOverriddenCallSiteKeysByRuleSignature: {},
      });
      expect(result.filesProcessed).toBe(1);
      expect(fake.tierBProcessed).toEqual([
        { projectId: 1, filePath, commitSha: HEAD_SHA },
      ]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("[state-diff] keeps local quarantine ambiguous and records Tier B evidence without an external policy", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-unconfigured-policy-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "caller.ts"),
      "export function caller() {\n  run();\n}\n",
    );

    const filePath = "caller.ts";
    const sourceContentHash = "a".repeat(64);
    const callSiteKey = createPortableCallSiteKey({
      filePath,
      sourceContentHash,
      startLine: 1,
      startColumn: 2,
      calleeKind: "bare",
      calleeName: "run",
    });
    const resolution: CallSiteResolutionRecord = {
      callSiteKey,
      identityVersion: 1,
      filePath,
      sourceContentHash,
      startLine: 1,
      startColumn: 2,
      calleeKind: "bare",
      calleeName: "run",
      callerNodeKey: "caller.ts#caller",
      resolutionClass: "unresolved",
      selectedTargetNodeKey: null,
      confidence: null,
      resolver: "strict-proof",
      ruleSignature: "unresolved-rule-v1",
      dependencyFingerprint: "b".repeat(64),
      dependencies: [],
      verificationStatus: "unverified",
      verifiedTargetNodeKey: null,
      isStale: false,
      candidates: [],
    };
    const { store } = makeStore(
      [],
      [{ filePath, contentHash: sourceContentHash }],
    );
    store.callSites.getForFiles = vi.fn(
      () =>
        new Map([
          [filePath, [{ targetFunction: "run", startLine: 1, startColumn: 2 }]],
        ]),
    );
    const applyTierBVerificationResults = vi.fn();
    Object.defineProperty(store, "callSiteResolutions", {
      value: {
        getForFile: vi.fn(() => [resolution]),
        getQuarantinedRuleSignatures: vi.fn(() => ["unresolved-rule-v1"]),
        applyTierBVerificationResults,
      },
    });
    appendTierBQueueEntries(store, [{ file: filePath, commitSha: HEAD_SHA }]);

    let request: EdgeResolutionRequest | undefined;
    const provider: IEdgeResolutionProvider = {
      name: "unconfigured-policy-provider",
      configure: vi.fn(),
      checkAvailability: vi.fn(async () => ({ available: true })),
      resolveEdges: vi.fn(async (value) => {
        request = value;
        const site = value.callsByFile?.[filePath]?.[0];
        return {
          edges: [],
          filesProcessed: value.files,
          filesFailed: [],
          callSiteResults: site
            ? [
                {
                  callSiteKey: site.callSiteKey!,
                  sourceContentHash: site.sourceContentHash!,
                  ruleSignature: site.ruleSignature!,
                  verificationPolicyVersion: site.verificationPolicyVersion!,
                  expectedTargetNodeKey: site.expectedTargetNodeKey ?? null,
                  resolutionClass: site.resolutionClass!,
                  verificationMode: site.verificationMode!,
                  outcome: "unique-local" as const,
                  targetNodeKey: "targets.ts#run",
                },
              ]
            : [],
        };
      }),
    };
    registerProvider(provider);

    try {
      await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit({
          listTrackedFilesWithBlobHash: vi.fn(
            async () => new Map([[filePath, sourceContentHash]]),
          ),
          listUntrackedFiles: vi.fn(async () => []),
          listModifiedFiles: vi.fn(async () => []),
        }),
        knowledgeGit: makeKnowledgeGit(),
      });

      expect(request?.callsByFile?.[filePath]).toEqual([
        {
          targetFunction: "run",
          startLine: 1,
          startColumn: 2,
          callSiteKey,
          ruleSignature: "unresolved-rule-v1",
          resolutionClass: "unresolved",
          effectiveResolutionClass: "ambiguous",
          verificationPolicyVersion: CALL_SITE_VERIFICATION_POLICY_VERSION,
          sourceContentHash,
          expectedTargetNodeKey: null,
          verificationMode: "tier-b",
        },
      ]);
      expect(request?.callResolutionCanary).toEqual({
        policyVersion: "sha256-callsite-rule-v2",
        sampleRate: 0.1,
        stratification: "rule-signature",
        hashInputFields: ["callSiteKey", "ruleSignature"],
        selectedCallSiteKeysByRuleSignature: {},
        ruleOverriddenCallSiteKeysByRuleSignature: {},
      });
      expect(applyTierBVerificationResults).toHaveBeenCalledWith(
        1,
        [
          {
            callSiteKey,
            sourceContentHash,
            ruleSignature: "unresolved-rule-v1",
            verificationPolicyVersion: CALL_SITE_VERIFICATION_POLICY_VERSION,
            expectedTargetNodeKey: null,
            resolutionClass: "unresolved",
            verificationMode: "tier-b",
            outcome: "unique-local",
            targetNodeKey: "targets.ts#run",
          },
        ],
        CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("no-ops on an empty queue without touching the provider", async () => {
    const providerFactory = vi.fn();
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: providerFactory,
    }));
    const { store } = makeStore();
    const git = makeGit();

    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-emptytest-"),
    );
    try {
      const result = await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git,
        knowledgeGit: makeKnowledgeGit(),
      });

      expect(result.kind).toBe("tierBBatch");
      expect(result.filesQueued).toBe(0);
      expect(providerFactory).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("runTierBBatch() -- language dispatch and deleted-file drop (§8e, §8g)", () => {
  it("[happy] schedules ambiguous and unresolved before likely and proven groups, while uncertified proven still reaches Tier B", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-resolution-priority-"),
    );
    for (const file of [
      "likely.ts",
      "proven.ts",
      "unresolved.ts",
      "ambiguous-z.ts",
      "ambiguous-a-1.ts",
      "ambiguous-a-2.ts",
      "unsupported.ts",
    ])
      fs.writeFileSync(path.join(workspaceRoot, file), "export {}\n");

    const { store } = makeStore();
    const recordsByFile = new Map([
      [
        "likely.ts",
        [{ resolutionClass: "likely", ruleSignature: "heuristic-v1" }],
      ],
      [
        "proven.ts",
        [
          {
            resolutionClass: "proven",
            ruleSignature: "single-candidate-this-v1",
          },
        ],
      ],
      [
        "unresolved.ts",
        [
          { resolutionClass: "likely", ruleSignature: "aaa-likely-v1" },
          { resolutionClass: "unresolved", ruleSignature: "needs-binding-v1" },
        ],
      ],
      [
        "ambiguous-z.ts",
        [{ resolutionClass: "ambiguous", ruleSignature: "z-rule-v1" }],
      ],
      [
        "ambiguous-a-1.ts",
        [{ resolutionClass: "ambiguous", ruleSignature: "a-rule-v1" }],
      ],
      [
        "ambiguous-a-2.ts",
        [{ resolutionClass: "ambiguous", ruleSignature: "a-rule-v1" }],
      ],
      [
        "unsupported.ts",
        [{ resolutionClass: "unsupported", ruleSignature: "unsupported-v1" }],
      ],
    ]);
    Object.defineProperty(store, "callSiteResolutions", {
      value: {
        getForFile: vi.fn((_projectId: number, file: string) =>
          (recordsByFile.get(file) ?? []).map((record, index) => ({
            callSiteKey: `${file}:call-${index}`,
            ...record,
          })),
        ),
      },
    });
    appendTierBQueueEntries(store, [
      { file: "likely.ts", commitSha: HEAD_SHA },
      { file: "proven.ts", commitSha: HEAD_SHA },
      { file: "unresolved.ts", commitSha: HEAD_SHA },
      { file: "ambiguous-z.ts", commitSha: HEAD_SHA },
      { file: "ambiguous-a-2.ts", commitSha: HEAD_SHA },
      { file: "ambiguous-a-1.ts", commitSha: HEAD_SHA },
      { file: "unsupported.ts", commitSha: HEAD_SHA },
    ]);

    let requestedFiles: string[] = [];
    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async (files) => {
          requestedFiles = files;
          return { edges: [], filesProcessed: files, filesFailed: [] };
        },
      ),
    );

    try {
      await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit(),
        knowledgeGit: makeKnowledgeGit(),
      });

      expect(requestedFiles).toEqual([
        "ambiguous-a-1.ts",
        "ambiguous-a-2.ts",
        "unresolved.ts",
        "unsupported.ts",
        "ambiguous-z.ts",
        "likely.ts",
        "proven.ts",
      ]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("[happy][invalid-input][state-diff] runs only hash-selected certified call sites plus every uncertified site, and completes fully certified non-canary files without LSP", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-callsite-canary-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "mixed.ts"),
      "export function caller() {\n  sampled();\n  ruleOnly();\n  uncertified();\n}\n",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "rule-only.ts"),
      "export function caller() {\n  ruleOnly();\n}\n",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "invalid-evidence.ts"),
      "missingKey();\nsourceMismatch();\nmissingSignature();\n",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage-mismatch.ts"),
      "known();\n",
    );

    const mixedSourceHash = "c".repeat(64);
    // Under v2, this deterministic key falls outside the 50% sample and keeps
    // the full-file non-canary skip assertion meaningful.
    const ruleOnlySourceHash = "f".repeat(64);
    const invalidEvidenceSourceHash = "d".repeat(64);
    const mismatchedSourceHash = "e".repeat(64);
    const coverageSourceHash = "f".repeat(64);
    const sourceHashes = [
      { filePath: "mixed.ts", contentHash: mixedSourceHash },
      { filePath: "rule-only.ts", contentHash: ruleOnlySourceHash },
      {
        filePath: "invalid-evidence.ts",
        contentHash: invalidEvidenceSourceHash,
      },
      { filePath: "coverage-mismatch.ts", contentHash: coverageSourceHash },
    ];
    const { store, fake } = makeStore([], sourceHashes);
    store.callSites.getForFiles = vi.fn(
      () =>
        new Map([
          [
            "mixed.ts",
            [
              { targetFunction: "sampled", startLine: 1, startColumn: 2 },
              { targetFunction: "ruleOnly", startLine: 2, startColumn: 2 },
              { targetFunction: "uncertified", startLine: 3, startColumn: 2 },
            ],
          ],
          [
            "rule-only.ts",
            [{ targetFunction: "ruleOnly", startLine: 1, startColumn: 2 }],
          ],
          [
            "invalid-evidence.ts",
            [
              { targetFunction: "missingKey", startLine: 0, startColumn: 0 },
              {
                targetFunction: "sourceMismatch",
                startLine: 1,
                startColumn: 0,
              },
              {
                targetFunction: "missingSignature",
                startLine: 2,
                startColumn: 0,
              },
            ],
          ],
          [
            "coverage-mismatch.ts",
            [{ targetFunction: "known", startLine: 0, startColumn: 0 }],
          ],
        ]),
    );

    const makeResolution = (
      filePath: string,
      sourceContentHash: string,
      startLine: number,
      calleeName: string,
      ruleSignature: string,
      startColumn = 2,
    ): CallSiteResolutionRecord => ({
      callSiteKey: createPortableCallSiteKey({
        filePath,
        sourceContentHash,
        startLine,
        startColumn,
        calleeKind: "bare",
        calleeName,
      }),
      identityVersion: 1,
      filePath,
      sourceContentHash,
      startLine,
      startColumn,
      calleeKind: "bare",
      calleeName,
      callerNodeKey: `${filePath}#caller`,
      resolutionClass: "proven",
      selectedTargetNodeKey: `targets.ts#${calleeName}`,
      confidence: null,
      resolver: "strict-proof",
      ruleSignature,
      dependencyFingerprint: "source-only",
      dependencies: [],
      verificationStatus: "unverified",
      verifiedTargetNodeKey: null,
      isStale: false,
      candidates: [],
    });
    const resolutionsByFile = new Map<string, CallSiteResolutionRecord[]>([
      [
        "mixed.ts",
        [
          makeResolution(
            "mixed.ts",
            mixedSourceHash,
            1,
            "sampled",
            "cert-rule-v1",
          ),
          makeResolution(
            "mixed.ts",
            mixedSourceHash,
            2,
            "ruleOnly",
            "cert-rule-v1",
          ),
          makeResolution(
            "mixed.ts",
            mixedSourceHash,
            3,
            "uncertified",
            "unseen-rule-v1",
          ),
        ],
      ],
      [
        "rule-only.ts",
        [
          makeResolution(
            "rule-only.ts",
            ruleOnlySourceHash,
            1,
            "ruleOnly",
            "cert-rule-v1",
          ),
        ],
      ],
      [
        "invalid-evidence.ts",
        [
          {
            ...makeResolution(
              "invalid-evidence.ts",
              invalidEvidenceSourceHash,
              0,
              "missingKey",
              "cert-rule-v1",
              0,
            ),
            callSiteKey: "",
          },
          makeResolution(
            "invalid-evidence.ts",
            mismatchedSourceHash,
            1,
            "sourceMismatch",
            "cert-rule-v1",
            0,
          ),
          makeResolution(
            "invalid-evidence.ts",
            invalidEvidenceSourceHash,
            2,
            "missingSignature",
            "",
            0,
          ),
        ],
      ],
      [
        "coverage-mismatch.ts",
        [
          makeResolution(
            "coverage-mismatch.ts",
            coverageSourceHash,
            0,
            "known",
            "cert-rule-v1",
            0,
          ),
          makeResolution(
            "coverage-mismatch.ts",
            coverageSourceHash,
            1,
            "extra",
            "cert-rule-v1",
            0,
          ),
        ],
      ],
    ]);
    Object.defineProperty(store, "callSiteResolutions", {
      value: {
        getForFile: vi.fn(
          (_projectId: number, file: string) =>
            resolutionsByFile.get(file) ?? [],
        ),
      },
    });
    appendTierBQueueEntries(store, [
      { file: "mixed.ts", commitSha: HEAD_SHA },
      { file: "rule-only.ts", commitSha: HEAD_SHA },
      { file: "invalid-evidence.ts", commitSha: HEAD_SHA },
      { file: "coverage-mismatch.ts", commitSha: HEAD_SHA },
    ]);

    let request: EdgeResolutionRequest | undefined;
    const provider: IEdgeResolutionProvider = {
      name: "canary-test-provider",
      configure: vi.fn(),
      checkAvailability: vi.fn(async () => ({ available: true })),
      resolveEdges: vi.fn(async (value) => {
        request = value;
        return {
          edges: [],
          filesProcessed: value.files,
          filesFailed: [],
        };
      }),
    };
    registerProvider(provider);

    try {
      const result = await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit({
          listTrackedFilesWithBlobHash: vi.fn(
            async () =>
              new Map([
                ["mixed.ts", mixedSourceHash],
                ["rule-only.ts", ruleOnlySourceHash],
                ["invalid-evidence.ts", invalidEvidenceSourceHash],
                ["coverage-mismatch.ts", coverageSourceHash],
              ]),
          ),
          listUntrackedFiles: vi.fn(async () => []),
          listModifiedFiles: vi.fn(async () => []),
        }),
        knowledgeGit: makeKnowledgeGit(),
        callResolutionCanary: {
          certification: createBatchCertificationDecision("cert-rule-v1"),
          canaryRate: 0.5,
        },
      });

      expect(request).toBeDefined();
      const receivedRequest = request!;
      expect(receivedRequest.files).toEqual(
        expect.arrayContaining([
          "mixed.ts",
          "invalid-evidence.ts",
          "coverage-mismatch.ts",
        ]),
      );
      expect(receivedRequest.files).toHaveLength(3);
      expect(receivedRequest.files).not.toContain("rule-only.ts");
      expect(receivedRequest.callsByFile).toMatchObject({
        "mixed.ts": [
          {
            targetFunction: "sampled",
            startLine: 1,
            startColumn: 2,
            callSiteKey: createPortableCallSiteKey({
              filePath: "mixed.ts",
              sourceContentHash: mixedSourceHash,
              startLine: 1,
              startColumn: 2,
              calleeKind: "bare",
              calleeName: "sampled",
            }),
            ruleSignature: "cert-rule-v1",
            resolutionClass: "proven",
            verificationMode: "canary",
          },
          {
            targetFunction: "ruleOnly",
            startLine: 2,
            startColumn: 2,
            callSiteKey: createPortableCallSiteKey({
              filePath: "mixed.ts",
              sourceContentHash: mixedSourceHash,
              startLine: 2,
              startColumn: 2,
              calleeKind: "bare",
              calleeName: "ruleOnly",
            }),
            ruleSignature: "cert-rule-v1",
            resolutionClass: "proven",
            verificationMode: "canary",
          },
          {
            targetFunction: "uncertified",
            startLine: 3,
            startColumn: 2,
            callSiteKey: createPortableCallSiteKey({
              filePath: "mixed.ts",
              sourceContentHash: mixedSourceHash,
              startLine: 3,
              startColumn: 2,
              calleeKind: "bare",
              calleeName: "uncertified",
            }),
            ruleSignature: "unseen-rule-v1",
            resolutionClass: "proven",
            verificationMode: "tier-b",
          },
        ],
      });
      expect(receivedRequest.callResolutionCanary).toMatchObject({
        policyVersion: "sha256-callsite-rule-v2",
        sampleRate: 0.5,
        stratification: "rule-signature",
        // Classification controls whether a site is eligible for skipping; it is not a canary hash dimension.
        hashInputFields: ["callSiteKey", "ruleSignature"],
        selectedCallSiteKeysByRuleSignature: {
          "cert-rule-v1": [
            createPortableCallSiteKey({
              filePath: "mixed.ts",
              sourceContentHash: mixedSourceHash,
              startLine: 2,
              startColumn: 2,
              calleeKind: "bare",
              calleeName: "ruleOnly",
            }),
            createPortableCallSiteKey({
              filePath: "mixed.ts",
              sourceContentHash: mixedSourceHash,
              startLine: 1,
              startColumn: 2,
              calleeKind: "bare",
              calleeName: "sampled",
            }),
          ],
        },
        ruleOverriddenCallSiteKeysByRuleSignature: {
          "cert-rule-v1": [
            createPortableCallSiteKey({
              filePath: "rule-only.ts",
              sourceContentHash: ruleOnlySourceHash,
              startLine: 1,
              startColumn: 2,
              calleeKind: "bare",
              calleeName: "ruleOnly",
            }),
          ],
        },
      });
      expect(receivedRequest.callsByFile?.["invalid-evidence.ts"]).toEqual([
        {
          targetFunction: "missingKey",
          startLine: 0,
          startColumn: 0,
          verificationMode: "tier-b",
        },
        {
          targetFunction: "sourceMismatch",
          startLine: 1,
          startColumn: 0,
          verificationMode: "tier-b",
        },
        {
          targetFunction: "missingSignature",
          startLine: 2,
          startColumn: 0,
          verificationMode: "tier-b",
        },
      ]);
      expect(receivedRequest.callsByFile?.["coverage-mismatch.ts"]).toEqual([
        {
          targetFunction: "known",
          startLine: 0,
          startColumn: 0,
          verificationMode: "tier-b",
        },
      ]);
      expect(result.filesProcessed).toBe(4);
      expect(result.filesFailed).toBe(0);
      expect(fake.tierBProcessed).toEqual(
        expect.arrayContaining([
          { projectId: 1, filePath: "rule-only.ts", commitSha: HEAD_SHA },
          { projectId: 1, filePath: "mixed.ts", commitSha: HEAD_SHA },
          {
            projectId: 1,
            filePath: "invalid-evidence.ts",
            commitSha: HEAD_SHA,
          },
          {
            projectId: 1,
            filePath: "coverage-mismatch.ts",
            commitSha: HEAD_SHA,
          },
        ]),
      );
      expect(
        JSON.parse(
          fake.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING) ?? "{}",
        ),
      ).toMatchObject({ headSha: HEAD_SHA, remainingQueue: [] });
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("drops a deleted-at-HEAD entry and skips an unsupported-language entry, both logged, leaving nothing to process", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-test-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "present.swift"),
      "import Foundation\n",
    );

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "deleted.ts", commitSha: HEAD_SHA },
      { file: "present.swift", commitSha: HEAD_SHA },
    ]);

    const providerFactory = vi.fn();
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: providerFactory,
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(2);
    expect(result.filesDroppedDeleted).toBe(1);
    expect(result.filesSkippedLanguage).toBe(1);
    expect(result.filesProcessed).toBe(0);
    expect(providerFactory).not.toHaveBeenCalled();

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("[state-diff][error-handling] forwards site-bound LSP outcomes through the batch without deriving evidence from aggregate edges", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-site-evidence-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "caller.ts"),
      "export function caller() {\n  oldTarget();\n  noAnswer();\n}\n",
    );

    const sourceContentHash = "7".repeat(64);
    const callSites = [
      { targetFunction: "oldTarget", startLine: 1, startColumn: 2 },
      { targetFunction: "noAnswer", startLine: 2, startColumn: 2 },
    ];
    const makeRecord = (
      startLine: number,
      calleeName: string,
    ): CallSiteResolutionRecord => ({
      callSiteKey: createPortableCallSiteKey({
        filePath: "caller.ts",
        sourceContentHash,
        startLine,
        startColumn: 2,
        calleeKind: "bare",
        calleeName,
      }),
      identityVersion: 1,
      filePath: "caller.ts",
      sourceContentHash,
      startLine,
      startColumn: 2,
      calleeKind: "bare",
      calleeName,
      callerNodeKey: "caller.ts#caller",
      resolutionClass: "proven",
      selectedTargetNodeKey: "targets.ts#oldTarget",
      confidence: null,
      resolver: "strict-proof",
      ruleSignature: "certified-rule-v1",
      dependencyFingerprint: "source-only",
      dependencies: [],
      verificationStatus: "unverified",
      verifiedTargetNodeKey: null,
      isStale: false,
      candidates: [],
    });
    const records = [makeRecord(1, "oldTarget"), makeRecord(2, "noAnswer")];
    const { store } = makeStore(
      ["caller.ts#caller", "targets.ts#oldTarget", "targets.ts#newTarget"],
      [{ filePath: "caller.ts", contentHash: sourceContentHash }],
    );
    store.callSites.getForFiles = vi.fn(
      () => new Map([["caller.ts", callSites]]),
    );
    const applyTierBVerificationResults = vi.fn();
    let transactionDepth = 0;
    Object.defineProperty(store, "withTransaction", {
      value: (fn: () => unknown) => {
        transactionDepth++;
        try {
          return fn();
        } finally {
          transactionDepth--;
        }
      },
    });
    applyTierBVerificationResults.mockImplementation(() => {
      expect(transactionDepth).toBe(1);
    });
    Object.defineProperty(store, "callSiteResolutions", {
      value: {
        getForFile: vi.fn(() => records),
        applyTierBVerificationResults,
      },
    });
    appendTierBQueueEntries(store, [
      { file: "caller.ts", commitSha: HEAD_SHA },
    ]);

    const expectedResults: CallSiteLspResolutionResult[] = [
      {
        callSiteKey: records[0].callSiteKey,
        sourceContentHash,
        ruleSignature: records[0].ruleSignature,
        verificationPolicyVersion: "sha256-callsite-rule-v2",
        expectedTargetNodeKey: records[0].selectedTargetNodeKey!,
        resolutionClass: "proven",
        verificationMode: "canary",
        outcome: "unique-local",
        targetNodeKey: "targets.ts#newTarget",
      },
      {
        callSiteKey: records[1].callSiteKey,
        sourceContentHash,
        ruleSignature: records[1].ruleSignature,
        verificationPolicyVersion: "sha256-callsite-rule-v2",
        expectedTargetNodeKey: records[1].selectedTargetNodeKey!,
        resolutionClass: "proven",
        verificationMode: "canary",
        outcome: "no-result",
      },
    ];
    const provider: IEdgeResolutionProvider = {
      name: "site-evidence-test-provider",
      configure: vi.fn(),
      checkAvailability: vi.fn(async () => ({ available: true })),
      resolveEdges: vi.fn(async (request) => ({
        edges: [],
        filesProcessed: request.files,
        filesFailed: [],
        callSiteResults: expectedResults,
      })),
    };
    registerProvider(provider);

    try {
      await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit({
          listTrackedFilesWithBlobHash: vi.fn(
            async () => new Map([["caller.ts", sourceContentHash]]),
          ),
          listUntrackedFiles: vi.fn(async () => []),
          listModifiedFiles: vi.fn(async () => []),
        }),
        knowledgeGit: makeKnowledgeGit(),
        callResolutionCanary: {
          certification: createBatchCertificationDecision("certified-rule-v1"),
          canaryRate: 1,
        },
      });

      expect(applyTierBVerificationResults).toHaveBeenCalledTimes(1);
      expect(applyTierBVerificationResults).toHaveBeenCalledWith(
        1,
        expectedResults,
        CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("runTierBBatch() -- edge application, pending finalize staging (§8d, §8f, §8g)", () => {
  async function makeWorkspace(): Promise<string> {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-tierb-test-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "export function foo() {}\n");
    return dir;
  }

  it("applies resolved edges (existing node_keys only), prunes orphans, and stages a pending record with an empty remaining queue on full success", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["b.ts#bar", "a.ts#foo"]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "a.ts#foo",
              targetNodeKey: "b.ts#bar",
              source: "lsp",
            },
          ],
          filesProcessed: ["a.ts"],
          filesFailed: [],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.edgesApplied).toBe(1);
    expect(result.filesProcessed).toBe(1);
    expect(result.filesFailed).toBe(0);
    expect(result.degraded).toBe(false);
    expect(fake.links).toHaveLength(1);
    expect(store.graph.pruneOrphanedLinks).toHaveBeenCalledTimes(1);

    const pendingRaw = fake.meta.get(
      GitConstants.META_KEY_TIER_B_BATCH_PENDING,
    );
    expect(pendingRaw!.length).toBeGreaterThanOrEqual(1);
    const pending = JSON.parse(pendingRaw!);
    expect(pending).toEqual({ headSha: HEAD_SHA, remainingQueue: [] });

    // The queue itself is untouched by analyze -- only SnapshotWorkflow's finalize drains it.
    const { readTierBQueue } = await import("./tier-b-queue.js");
    expect(readTierBQueue(store)).toHaveLength(1);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("drops an edge whose node_key does not resolve to an existing L2 node -- never invents one", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo"]); // "b.ts#bar" deliberately absent
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "a.ts#foo",
              targetNodeKey: "b.ts#bar",
              source: "lsp",
            },
          ],
          filesProcessed: ["a.ts"],
          filesFailed: [],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.edgesApplied).toBe(0);
    expect(fake.links).toHaveLength(0);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("keeps a per-file LSP failure in the pending remaining queue for the next batch (§8g)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore([]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [{ file: "a.ts", reason: "server choked" }],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesFailed).toBe(1);
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("[state-diff] does not mark a file processed when it is retired during edge resolution", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo"]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    let continueResolution!: () => void;
    const resolutionPaused = new Promise<void>((resolve) => {
      continueResolution = resolve;
    });
    let signalResolutionStarted!: () => void;
    const resolutionStarted = new Promise<void>((resolve) => {
      signalResolutionStarted = resolve;
    });
    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => {
          signalResolutionStarted();
          await resolutionPaused;
          return {
            edges: [],
            filesProcessed: ["a.ts"],
            filesFailed: [],
          };
        },
      ),
    );

    const knowledgeGit = makeKnowledgeGit();
    const batch = runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit,
    });
    await resolutionStarted;
    await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, () =>
      store.withWriteLock(() =>
        removeTierBQueueEntriesForFiles(store, ["a.ts"]),
      ),
    );
    continueResolution();
    await batch;

    expect(fake.tierBProcessed).toEqual([]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("[state-diff] does not restage a failed file when it is retired during edge resolution", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore([]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    let continueResolution!: () => void;
    const resolutionPaused = new Promise<void>((resolve) => {
      continueResolution = resolve;
    });
    let signalResolutionStarted!: () => void;
    const resolutionStarted = new Promise<void>((resolve) => {
      signalResolutionStarted = resolve;
    });
    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => {
          signalResolutionStarted();
          await resolutionPaused;
          return {
            edges: [],
            filesProcessed: [],
            filesFailed: [{ file: "a.ts", reason: "server choked" }],
          };
        },
      ),
    );

    const knowledgeGit = makeKnowledgeGit();
    const batch = runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit,
    });
    await resolutionStarted;
    await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, () =>
      store.withWriteLock(() =>
        removeTierBQueueEntriesForFiles(store, ["a.ts"]),
      ),
    );
    continueResolution();
    await batch;

    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("[state-diff] does not stamp a permanently failed file when it is retired during edge resolution", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore([]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    let continueResolution!: () => void;
    const resolutionPaused = new Promise<void>((resolve) => {
      continueResolution = resolve;
    });
    let signalResolutionStarted!: () => void;
    const resolutionStarted = new Promise<void>((resolve) => {
      signalResolutionStarted = resolve;
    });
    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => {
          signalResolutionStarted();
          await resolutionPaused;
          return {
            edges: [],
            filesProcessed: [],
            filesFailed: [
              { file: "a.ts", reason: "not supported", retryable: false },
            ],
          };
        },
      ),
    );

    const knowledgeGit = makeKnowledgeGit();
    const batch = runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit,
    });
    await resolutionStarted;
    await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, () =>
      store.withWriteLock(() =>
        removeTierBQueueEntriesForFiles(store, ["a.ts"]),
      ),
    );
    continueResolution();
    await batch;

    expect(fake.tierBProcessed).toEqual([]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("[state-diff] skips resolved edges when their file is re-queued at a newer commit", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo", "b.ts#bar"]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "old" }]);

    let continueResolution!: () => void;
    const resolutionPaused = new Promise<void>((resolve) => {
      continueResolution = resolve;
    });
    let signalResolutionStarted!: () => void;
    const resolutionStarted = new Promise<void>((resolve) => {
      signalResolutionStarted = resolve;
    });
    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => {
          signalResolutionStarted();
          await resolutionPaused;
          return {
            edges: [
              {
                sourceNodeKey: "a.ts#foo",
                targetNodeKey: "b.ts#bar",
                source: "lsp",
              },
            ],
            filesProcessed: ["a.ts"],
            filesFailed: [],
          };
        },
      ),
    );

    const knowledgeGit = makeKnowledgeGit();
    const batch = runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit,
    });
    await resolutionStarted;
    await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, () =>
      store.withWriteLock(() =>
        appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "new" }]),
      ),
    );
    continueResolution();
    const result = await batch;

    expect(fake.links).toEqual([]);
    expect(result.edgesApplied).toBe(0);
    expect(result.filesProcessed).toBe(0);
    expect(readTierBQueue(store)).toEqual([{ file: "a.ts", commitSha: "new" }]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("[state-diff] applies an edge for a file that remains current in the Tier B queue", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo", "b.ts#bar"]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "current" }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "a.ts#foo",
              targetNodeKey: "b.ts#bar",
              source: "lsp",
            },
          ],
          filesProcessed: ["a.ts"],
          filesFailed: [],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(fake.links).toHaveLength(1);
    expect(result.edgesApplied).toBe(1);
    expect(result.filesProcessed).toBe(1);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("[state-diff] applies an edge whose current source path itself contains '#'", async () => {
    const workspaceRoot = await makeWorkspace();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(join(workspaceRoot, "src", "C#"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, "src", "C#", "a.ts"),
      "export function foo() {}\n",
    );
    const { store, fake } = makeStore(["src/C#/a.ts#foo", "b.ts#bar"]);
    appendTierBQueueEntries(store, [
      { file: "src/C#/a.ts", commitSha: "current" },
    ]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "src/C#/a.ts#foo",
              targetNodeKey: "b.ts#bar",
              source: "lsp",
            },
          ],
          filesProcessed: ["src/C#/a.ts"],
          filesFailed: [],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(fake.links).toHaveLength(1);
    expect(result.edgesApplied).toBe(1);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("drops a permanently-failed file (retryable: false) from the remaining queue but stamps it Tier-B-tried (2026-08 moby benchmark finding: an uncapped full-repo run re-processed permanently-unloadable files on every batch, ~0 edges)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo"], []);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [
            { file: "a.ts", reason: "no package metadata", retryable: false },
          ],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    // The permanent failure is reported in the result/log, but excluded from the retried queue.
    expect(result.filesFailed).toBe(0);
    expect(result.filesFailedPermanent).toBe(1);
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([]);
    // ...and, like a successfully processed file, it gets stamped so `markTierBProcessed`-aware
    // consumers (doctor's coverage counts) don't keep seeing it as "never attempted".
    expect(fake.tierBProcessed).toEqual([
      { projectId: 1, filePath: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("terminally skips a not-applicable project file without error-level logging or retry (#413)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo"], []);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [
            {
              file: "a.ts",
              reason: "Could not find source file: 'a.ts'.",
              retryable: false,
              notApplicable: true,
            },
          ],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesFailed).toBe(0);
    expect(result.filesFailedPermanent).toBe(0);
    expect(result.filesSkippedNotApplicable).toBe(1);

    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([]);
    expect(fake.tierBProcessed).toEqual([
      { projectId: 1, filePath: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    const path = await import("node:path");
    const logPath = path.join(
      workspaceRoot,
      DOCUVIA_DIR_NAME,
      DOCUVIA_LOGS_DIR_NAME,
      ANALYZE_LOG_FILE_NAME,
    );
    const entries = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const skipped = entries.find(
      (entry) => entry.event === "analyze.tierB.file_skipped_not_applicable",
    );
    expect(skipped).toMatchObject({
      file: "a.ts",
      reason: "Could not find source file: 'a.ts'.",
    });
    expect(skipped.level).toBeUndefined();

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("resets an existing zero-progress streak when a healthy provider terminally skips a not-applicable file (#413)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore(["a.ts#foo"], []);
    store.meta.set(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES, "2");
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [
            {
              file: "a.ts",
              reason: "Could not find source file: 'a.ts'.",
              retryable: false,
              notApplicable: true,
            },
          ],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesSkippedNotApplicable).toBe(1);
    expect(result.zeroProgressWatchdogTripped).toBe(false);
    expect(
      store.meta.get(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES),
    ).toBe("0");

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("trips the zero-progress watchdog on the Nth consecutive zero-progress batch: the still-retryable remainder is declared permanently-failed, dropped from the re-queue, and stamped (issue #22 split 2 -- the per-file retryable:false classification can't reach files whose only signal is a batch-level deadline cut, so the cross-batch counter is the safety net for them)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore([]);
    // Two prior batches already drained an attemptable set with zero progress -- this run is the
    // 3rd consecutive one (DEFAULT_TIER_B_ZERO_PROGRESS_MAX_BATCHES: 3).
    store.meta.set(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES, "2");
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [
            {
              file: "a.ts",
              reason: "exceeded its batch timeout",
              retryable: true,
            },
          ],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    // The watchdog escalated the still-retryable remainder to permanent: nothing is re-queued,
    // the file is reported as permanently failed, and it is stamped Tier-B-tried.
    expect(result.filesFailed).toBe(0);
    expect(result.filesFailedPermanent).toBe(1);
    expect(result.zeroProgressWatchdogTripped).toBe(true);
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([]);
    expect(fake.tierBProcessed).toEqual([
      { projectId: 1, filePath: "a.ts", commitSha: HEAD_SHA },
    ]);
    // The streak is reset once the watchdog has fired.
    expect(
      store.meta.get(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES),
    ).toBe("0");

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("accumulates the zero-progress streak across batches and does NOT trip before the Nth one -- the retryable failure stays re-queued (watchdog counts up, not over)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore([]);
    store.meta.set(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES, "1");
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [
            {
              file: "a.ts",
              reason: "exceeded its batch timeout",
              retryable: true,
            },
          ],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    // 1 prior streak + this zero-progress batch = 2 < 3: no watchdog, the file stays re-queued.
    expect(result.zeroProgressWatchdogTripped).toBe(false);
    expect(result.filesFailed).toBe(1);
    expect(result.filesFailedPermanent).toBe(0);
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "a.ts", commitSha: HEAD_SHA },
    ]);
    expect(
      store.meta.get(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES),
    ).toBe("2");
    // No stamping on a not-yet-triggered batch.
    expect(fake.tierBProcessed).toEqual([]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("does not advance the streak when a zero-progress batch has nothing retryable left to escalate (every attempt already permanently failed -- nothing to re-attempt, so nothing for the watchdog to retire)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore([]);
    store.meta.set(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES, "2");
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [
            { file: "a.ts", reason: "no package metadata", retryable: false },
          ],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    // No 0-progress batch with nothing to re-queue: the permanent failure retires the file
    // directly, so the watchdog has nothing to escalate -- and must not fire just because the
    // streak was at the threshold.
    expect(result.zeroProgressWatchdogTripped).toBe(false);
    expect(
      store.meta.get(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES),
    ).toBe("2");

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("resets the zero-progress streak whenever a batch actually makes progress", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore(["a.ts#foo"]);
    store.meta.set(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES, "2");
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: ["a.ts"],
          filesFailed: [],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.zeroProgressWatchdogTripped).toBe(false);
    expect(
      store.meta.get(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES),
    ).toBe("0");

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("keeps a retryable failure (retryable: true -- whole-batch timeout cut the file's turn short) in the remaining queue for the next batch", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore([]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [
            {
              file: "a.ts",
              reason: "exceeded its batch timeout",
              retryable: true,
            },
          ],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesFailed).toBe(1);
    expect(result.filesFailedPermanent).toBe(0);
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("does not let a degraded batch (provider unavailable -- an environment problem, not a file one) count toward the zero-progress streak", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore([]);
    // Two prior zero-progress batches queued the file. A degraded run between them must not
    // silently erase that history (nor advance it -- the lack of progress is environmental).
    store.meta.set(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES, "2");
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: false, reason: "binary not resolvable" }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [],
          unavailableReason: "binary not resolvable",
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.degraded).toBe(true);
    expect(result.zeroProgressWatchdogTripped).toBe(false);
    // The streak is untouched by a degraded run -- the file is NOT escalated to permanent on a
    // share of an environment outage.
    expect(
      store.meta.get(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES),
    ).toBe("2");
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("issue #33: a stray secondary-language degradation (rust-family bucket healthy, one bundled .rb formula's ruby bucket degraded) does NOT degrade the whole run -- degraded: false with the stray shape surfaced", async () => {
    const workspaceRoot = await makeWorkspace();
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.writeFileSync(
      path.join(workspaceRoot, "brew.rb"),
      "class Brew < Formula\nend\n",
    );
    const { store } = makeStore([]);
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "brew.rb", commitSha: HEAD_SHA },
    ]);

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () =>
        makeProvider(
          async () => ({ available: true }),
          async () => ({
            edges: [],
            filesProcessed: ["a.ts"],
            filesFailed: [],
          }),
        ),
      ruby: () =>
        makeProvider(
          async () => ({ available: false, reason: "ruby-lsp not installed" }),
          async () => ({
            edges: [],
            filesProcessed: [],
            filesFailed: [],
            unavailableReason: 'Failed to spawn LSP server "ruby-lsp"',
          }),
          "ruby-lsp",
        ),
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    // The 1-file healthy bucket made progress, so the run as a whole is NOT degraded (the ripgrep
    // 100-file-healthy run mislabeled "degraded" over pkg/brew/ripgrep-bin.rb was the bug).
    expect(result.degraded).toBe(false);
    expect(result.degradedReason).toBeUndefined();
    // ...but the stray bucket's degradation is still recorded for per-language diagnostics.
    expect(result.degradedLanguages).toEqual([
      { languageId: "ruby", reason: 'Failed to spawn LSP server "ruby-lsp"' },
    ]);
    expect(result.strayLanguageDegraded).toBe(true);
    expect(result.fullyDegraded).toBe(false);
    expect(result.filesProcessed).toBe(1);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("issue #33: a stray-degraded bucket no longer suppresses the zero-progress watchdog for a healthy-but-zero-progress bucket, and the degraded bucket's files are never escalated onto the permanent queue", async () => {
    const workspaceRoot = await makeWorkspace();
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.writeFileSync(
      path.join(workspaceRoot, "brew.rb"),
      "class Brew < Formula\nend\n",
    );
    const { store, fake } = makeStore([]);
    // Two prior zero-progress batches -- this is the Nth (DEFAULT_TIER_B_ZERO_PROGRESS_MAX_BATCHES: 3).
    // The healthy typescript bucket is the zero-progress one; the degraded ruby bucket is unrelated.
    store.meta.set(GitConstants.META_KEY_TIER_B_ZERO_PROGRESS_BATCHES, "2");
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "brew.rb", commitSha: HEAD_SHA },
    ]);

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () =>
        makeProvider(
          async () => ({ available: true }),
          async () => ({
            edges: [],
            filesProcessed: [],
            filesFailed: [
              {
                file: "a.ts",
                reason: "exceeded its batch timeout",
                retryable: true,
              },
            ],
          }),
        ),
      ruby: () =>
        makeProvider(
          async () => ({ available: false, reason: "ruby-lsp not installed" }),
          async () => ({
            edges: [],
            filesProcessed: [],
            filesFailed: [],
            unavailableReason: 'Failed to spawn LSP server "ruby-lsp"',
          }),
          "ruby-lsp",
        ),
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    // The healthy zero-progress bucket's file trips the watchdog despite the unrelated stray
    // degradation (before issue #33 the aggregate unavailableReason blanket-skipped the streak).
    expect(result.zeroProgressWatchdogTripped).toBe(true);
    expect(result.strayLanguageDegraded).toBe(true);
    // The healthy file is escalated to permanent-failed and stamped.
    expect(result.filesFailedPermanent).toBe(1);
    expect(fake.tierBProcessed).toEqual([
      { projectId: 1, filePath: "a.ts", commitSha: HEAD_SHA },
    ]);
    // The degraded ruby bucket's file is NOT conflated into the zero-progress escalation -- it
    // stays queued for when ruby-lsp is installed.
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "brew.rb", commitSha: HEAD_SHA },
    ]);
    expect(result.filesFailed).toBe(1);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("degrades honestly when the provider is unavailable: no edges applied, whole toProcess set stays queued", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo"]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: false, reason: "binary not resolvable" }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [],
          unavailableReason: "binary not resolvable",
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("binary not resolvable");
    expect(result.edgesApplied).toBe(0);
    expect(fake.links).toHaveLength(0);

    const pending = JSON.parse(
      fake.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "a.ts", commitSha: HEAD_SHA },
    ]);

    // Regression: `doctor`'s LOGS diagnostic scans `.docuvia/logs/*.log` for `entry.level >= 50`
    // to decide whether a past run had a real failure -- every event this workflow wrote was
    // missing `level` entirely, so a degraded batch could never trip that check (doctor kept
    // reporting the LOGS category healthy right after a run that produced zero edges; live-
    // reproduced against nestjs/nest in the 2026-07 CLI benchmark). Assert the actual JSONL file
    // on disk, not just the in-memory `result` -- that's what doctor reads.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const logLines = fs
      .readFileSync(
        path.join(workspaceRoot, ".docuvia", "logs", "analyze.log"),
        "utf8",
      )
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const degradedLine = logLines.find(
      (line) => line.event === "analyze.tierB.degraded",
    );
    expect(degradedLine?.level).toBeGreaterThanOrEqual(50);
    const summaryLine = logLines.find(
      (line) => line.event === "analyze.tierB.summary",
    );
    expect(summaryLine?.level).toBeGreaterThanOrEqual(50);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("preserves partial progress on a whole-batch timeout: applies edges/counts filesProcessed for files completed before the deadline, only restages the unreached file", async () => {
    // Models what lsp-edge-provider-base.ts's processAllFiles now actually returns on a timeout
    // that hit partway through: unavailableReason set (still degraded overall -- exit code/log
    // level), but filesProcessed/edges reflect real completed work, and only the unreached file
    // lands in filesFailed. Before the run-tier-b-batch.ts fix, any unavailableReason at all threw
    // away edges/filesProcessed and restaged the WHOLE original toProcess set, not just what
    // never got reached (2026-07 CLI benchmark finding, C# Tier B against a large Orleans
    // solution -- "do first, regardless of direction").
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["b.ts#bar", "a.ts#foo"]);
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "c.ts", commitSha: HEAD_SHA },
    ]);
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.writeFileSync(
      path.join(workspaceRoot, "c.ts"),
      "export function baz() {}\n",
    );

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "a.ts#foo",
              targetNodeKey: "b.ts#bar",
              source: "lsp",
            },
          ],
          filesProcessed: ["a.ts"],
          filesFailed: [
            {
              file: "c.ts",
              reason:
                "Tier B LSP batch exceeded its 100ms timeout and was aborted",
            },
          ],
          unavailableReason:
            "Tier B LSP batch exceeded its 100ms timeout and was aborted",
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toMatch(/exceeded its 100ms timeout/);
    expect(result.filesProcessed).toBe(1);
    expect(result.filesFailed).toBe(1);
    expect(result.edgesApplied).toBe(1);
    expect(fake.links).toHaveLength(1);

    const pending = JSON.parse(
      fake.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    // Only the unreached file gets restaged -- "a.ts" already succeeded and must not be
    // re-processed on the next run.
    expect(pending.remainingQueue).toEqual([
      { file: "c.ts", commitSha: HEAD_SHA },
    ]);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("idempotency (gating test 2): a crash mid-LSP never touches tierBQueue -- a re-run converges", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore([]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);
    const queueBefore = fake.meta.get(GitConstants.META_KEY_TIER_B_QUEUE);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => {
          throw new Error("LSP process crashed mid-batch");
        },
      ),
    );

    await expect(
      runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit(),
        knowledgeGit: makeKnowledgeGit(),
      }),
    ).rejects.toThrow("LSP process crashed mid-batch");

    expect(fake.meta.get(GitConstants.META_KEY_TIER_B_QUEUE)).toBe(queueBefore);
    expect(
      fake.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING),
    ).toBeUndefined();

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
});

describe("runTierBBatch() -- full-resync flag and Tier B processed-at stamping (typescript-cli-benchmark.md §5.3/§5.7 items 1-2)", () => {
  async function makeWorkspace(): Promise<string> {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-full-test-"),
    );
    fs.writeFileSync(path.join(dir, "a.ts"), "export function foo() {}\n");
    fs.writeFileSync(path.join(dir, "b.ts"), "export function bar() {}\n");
    fs.writeFileSync(path.join(dir, "c.ts"), "export function baz() {}\n");
    return dir;
  }

  it("full: true dispatches every store.files.getAllHashes() file, not just the pre-queued ones", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore(
      [],
      [
        { filePath: "a.ts", contentHash: "hash-a" },
        { filePath: "b.ts", contentHash: "hash-b" },
        { filePath: "c.ts", contentHash: "hash-c" },
      ],
    );
    // Only "a.ts" is pre-queued -- "full: true" must still dispatch "b.ts"/"c.ts" too.
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    const resolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts", "b.ts", "c.ts"],
      filesFailed: [],
    });
    registerProvider(
      makeProvider(async () => ({ available: true }), resolveEdges),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
      full: true,
    });

    expect(result.filesQueued).toBe(3);
    expect(resolveEdges).toHaveBeenCalledTimes(1);
    expect(resolveEdges.mock.calls[0][0].sort()).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("full: false/undefined is byte-identical to today's behavior -- only pre-queued files are dispatched (regression guard)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore(
      [],
      [
        { filePath: "a.ts", contentHash: "hash-a" },
        { filePath: "b.ts", contentHash: "hash-b" },
        { filePath: "c.ts", contentHash: "hash-c" },
      ],
    );
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    const resolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts"],
      filesFailed: [],
    });
    registerProvider(
      makeProvider(async () => ({ available: true }), resolveEdges),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(1);
    expect(resolveEdges).toHaveBeenCalledTimes(1);
    expect(resolveEdges.mock.calls[0][0]).toEqual(["a.ts"]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("markTierBProcessed is called once per outcome.filesProcessed entry, with the batch's resolved headSha -- never for a failed/timed-out file", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo", "b.ts#bar"], []);
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "b.ts", commitSha: HEAD_SHA },
    ]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: ["a.ts"],
          filesFailed: [{ file: "b.ts", reason: "server choked" }],
        }),
      ),
    );

    await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(fake.tierBProcessed).toEqual([
      { projectId: 1, filePath: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("does not call markTierBProcessed for any file when nothing was actually processed (e.g. the empty-queue no-op path)", async () => {
    const { store, fake } = makeStore([], []);

    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-noop-test-"),
    );
    try {
      await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit(),
        knowledgeGit: makeKnowledgeGit(),
      });

      expect(fake.tierBProcessed).toEqual([]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("runTierBBatch() -- multi-language registry dispatch (multi-language-lsp-support plan, Finding A)", () => {
  it("dispatches a queued file to the provider registered for its language, never touching a different language's registered provider, and honestly skips an extension with no dispatch entry", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-multilang-test-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "a.ts"),
      "export function foo() {}\n",
    );
    fs.writeFileSync(path.join(workspaceRoot, "b.py"), "def foo(): pass\n");

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "b.py", commitSha: HEAD_SHA },
    ]);

    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts"],
      filesFailed: [],
    });
    const tsProvider = makeProvider(
      async () => ({ available: true }),
      tsResolveEdges,
      "typescript-language-server",
    );

    const pyResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["b.py"],
      filesFailed: [],
    });
    const pyProvider = makeProvider(
      async () => ({ available: true }),
      pyResolveEdges,
      "pyright",
    );

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => tsProvider,
      python: () => pyProvider,
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(2);
    // Slice 1 added a `.py` dispatch entry -- both files are now routed to their own registered
    // provider (never the other language's), proving dispatch is by the language-dispatch table
    // in combination with the registry, not a hardcoded single-language path.
    expect(result.filesSkippedLanguage).toBe(0);
    expect(result.filesProcessed).toBe(2);
    expect(result.degraded).toBe(false);
    expect(tsResolveEdges).toHaveBeenCalledTimes(1);
    expect(tsResolveEdges.mock.calls[0][0]).toEqual(["a.ts"]);
    expect(pyResolveEdges).toHaveBeenCalledTimes(1);
    expect(pyResolveEdges.mock.calls[0][0]).toEqual(["b.py"]);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("honestly skips an extension with no dispatch entry at all (e.g. Swift, still unshipped)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-multilang-test-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "a.ts"),
      "export function foo() {}\n",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "b.swift"),
      "import Foundation\n",
    );

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "b.swift", commitSha: HEAD_SHA },
    ]);

    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts"],
      filesFailed: [],
    });
    const tsProvider = makeProvider(
      async () => ({ available: true }),
      tsResolveEdges,
      "typescript-language-server",
    );

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => tsProvider,
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(2);
    expect(result.filesSkippedLanguage).toBe(1);
    expect(result.filesProcessed).toBe(1);
    expect(result.degraded).toBe(false);
    expect(tsResolveEdges).toHaveBeenCalledTimes(1);
    expect(tsResolveEdges.mock.calls[0][0]).toEqual(["a.ts"]);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
});
