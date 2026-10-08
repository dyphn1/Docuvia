import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMockLogger,
  createPortableCallSiteKey,
  docuviaFactory,
  resetFactoryForTests,
  TOKENS,
  type CallSiteResolutionRecord,
  type EdgeResolutionCallSite,
  type EdgeResolutionOutcome,
  type EdgeResolutionRequest,
  type IEdgeResolutionProvider,
  type IGraphStore,
  type IGitProvider,
} from "@workspace/contracts";
import {
  loadQ1NamedImportCertificationArtifact,
  loadShippedQ1NamedImportCertificationArtifact,
} from "../src/workflows/analyze/call-resolution-certification.js";
import { isCallResolutionTierBCanary } from "../src/workflows/analyze/call-resolution-tier-b-canary.js";
import { resolveEdgesForLanguageBuckets } from "../src/workflows/analyze/tier-b-edge-resolution-orchestrator.js";

const Q1_SIGNATURE = "q1:named-import:v1";
const OTHER_SIGNATURE = "q2:reexport-trace:v1";
const FILE_PATH = "caller.ts";
const CANARY_RATE = 0.1;
const FROZEN_Q1_RULE_CONFIGURATION_SHA256 =
  "4f1399a505ff5bfc3e836b6bf99513e03221701cf317d1838a1cfcac15bd83bd";

interface FixtureSite {
  calleeName: string;
  callSiteKey: string;
  startLine: number;
  ruleSignature: string;
  resolution: CallSiteResolutionRecord;
}

let workspaceRoot: string;

beforeEach(() => {
  resetFactoryForTests();
  workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "docuvia-q1-certification-runtime-"),
  );
});

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("Q1 certification runtime scheduling", () => {
  it("[happy] skips non-canary Q1 sites only with a trusted certified-source decision", async () => {
    const certification = loadQ1NamedImportCertificationArtifact(
      readShippedArtifact(),
      FROZEN_Q1_RULE_CONFIGURATION_SHA256,
    );
    const sites = fixtureSites();
    const scheduled = await resolveSites(sites, {
      certification,
      canaryRate: CANARY_RATE,
    });

    expect(scheduled.map((site) => site.targetFunction)).toEqual([
      sites.q1Canary.calleeName,
      sites.other.calleeName,
    ]);
    expect(scheduled[0]).toMatchObject({ verificationMode: "canary" });
    expect(scheduled[1]).toMatchObject({ verificationMode: "tier-b" });
  });

  it("[state-diff] trusts recertified evidence and still schedules canary and non-Q1 sites", async () => {
    const decision = loadShippedQ1NamedImportCertificationArtifact();
    const sites = fixtureSites();
    const scheduled = await resolveSites(sites, {
      certification: decision,
      canaryRate: CANARY_RATE,
    });

    expect(decision.status).toBe("loaded");
    expect(scheduled.map((site) => site.targetFunction)).toEqual([
      sites.q1Canary.calleeName,
      sites.other.calleeName,
    ]);
    expect(scheduled[0]).toMatchObject({ verificationMode: "canary" });
    expect(scheduled[1]).toMatchObject({ verificationMode: "tier-b" });
  });

  it("[invalid-input] rejects tampered artifact bytes and schedules every site", async () => {
    const raw = readShippedArtifact();
    const decision = loadQ1NamedImportCertificationArtifact(`${raw} `);
    const sites = fixtureSites();
    const scheduled = await resolveSites(sites, {
      certification: decision,
      canaryRate: CANARY_RATE,
    });

    expect(decision.status).toBe("rejected");
    expect(scheduled.map((site) => site.targetFunction)).toEqual([
      sites.q1NonCanary.calleeName,
      sites.q1Canary.calleeName,
      sites.other.calleeName,
    ]);
    expect(
      scheduled.slice(0, 2).every((site) => site.verificationMode === "tier-b"),
    ).toBe(true);
  });

  it("[error-handling] rejects a changed Q1 rule-configuration hash and schedules all sites", async () => {
    const decision = loadQ1NamedImportCertificationArtifact(
      readShippedArtifact(),
      "0".repeat(64),
    );
    const sites = fixtureSites();
    const scheduled = await resolveSites(sites, {
      certification: decision,
      canaryRate: CANARY_RATE,
    });

    expect(decision.status).toBe("rejected");
    expect(decision.rejectionReasons.length).toBeGreaterThan(0);
    expect(scheduled).toHaveLength(3);
    expect(scheduled.every((site) => site.verificationMode === "tier-b")).toBe(
      true,
    );
  });

  it("[stress] keeps the pinned decision stable across repeated resource loads", () => {
    const decisions = Array.from({ length: 100 }, () =>
      loadShippedQ1NamedImportCertificationArtifact(),
    );

    expect(decisions.every((decision) => decision.status === "loaded")).toBe(
      true,
    );
    expect(
      new Set(decisions.map((decision) => decision.artifactSha256)).size,
    ).toBe(1);
  });

  it("[state-diff] quarantine keeps Q1 on Tier B with the effective class overridden", async () => {
    const certification = loadQ1NamedImportCertificationArtifact(
      readShippedArtifact(),
      FROZEN_Q1_RULE_CONFIGURATION_SHA256,
    );
    const sites = fixtureSites();
    const scheduled = await resolveSites(sites, {
      certification,
      quarantinedRuleSignatures: new Set([Q1_SIGNATURE]),
      canaryRate: CANARY_RATE,
    });

    expect(scheduled.map((site) => site.targetFunction)).toEqual([
      sites.q1NonCanary.calleeName,
      sites.q1Canary.calleeName,
      sites.other.calleeName,
    ]);
    expect(scheduled.slice(0, 2)).toEqual([
      expect.objectContaining({
        verificationMode: "tier-b",
        effectiveResolutionClass: "ambiguous",
      }),
      expect.objectContaining({
        verificationMode: "tier-b",
        effectiveResolutionClass: "ambiguous",
      }),
    ]);
  });
});

function fixtureSites(): {
  sourceContentHash: string;
  q1Canary: FixtureSite;
  q1NonCanary: FixtureSite;
  other: FixtureSite;
  sites: FixtureSite[];
} {
  const content = Array.from(
    { length: 256 },
    (_, index) => `candidate_${index}();`,
  ).join("\n");
  fs.writeFileSync(path.join(workspaceRoot, FILE_PATH), content, "utf8");
  const sourceContentHash = createHash("sha256").update(content).digest("hex");
  const candidates = Array.from({ length: 256 }, (_, startLine) => {
    const calleeName = `candidate_${startLine}`;
    const callSiteKey = createPortableCallSiteKey({
      filePath: FILE_PATH,
      sourceContentHash,
      startLine,
      startColumn: 0,
      calleeKind: "bare",
      calleeName,
    });
    return { calleeName, callSiteKey, startLine };
  });
  const canaryCandidate = candidates.find(({ callSiteKey }) =>
    isCallResolutionTierBCanary(callSiteKey, Q1_SIGNATURE, CANARY_RATE),
  );
  const nonCanaryCandidate = candidates.find(
    ({ callSiteKey }) =>
      !isCallResolutionTierBCanary(callSiteKey, Q1_SIGNATURE, CANARY_RATE),
  );
  const otherCandidate = candidates.find(
    ({ callSiteKey }) =>
      callSiteKey !== canaryCandidate?.callSiteKey &&
      callSiteKey !== nonCanaryCandidate?.callSiteKey &&
      !isCallResolutionTierBCanary(callSiteKey, OTHER_SIGNATURE, CANARY_RATE),
  );
  if (!canaryCandidate || !nonCanaryCandidate || !otherCandidate) {
    throw new Error("fixture did not produce the required canary strata");
  }

  const q1Canary = asFixtureSite(
    canaryCandidate,
    Q1_SIGNATURE,
    sourceContentHash,
  );
  const q1NonCanary = asFixtureSite(
    nonCanaryCandidate,
    Q1_SIGNATURE,
    sourceContentHash,
  );
  const other = asFixtureSite(
    otherCandidate,
    OTHER_SIGNATURE,
    sourceContentHash,
  );
  return {
    sourceContentHash,
    q1Canary,
    q1NonCanary,
    other,
    sites: [q1NonCanary, q1Canary, other],
  };
}

function asFixtureSite(
  candidate: Omit<FixtureSite, "ruleSignature" | "resolution">,
  ruleSignature: string,
  sourceContentHash: string,
): FixtureSite {
  return {
    ...candidate,
    ruleSignature,
    resolution: {
      callSiteKey: candidate.callSiteKey,
      identityVersion: 1,
      filePath: FILE_PATH,
      sourceContentHash,
      startLine: candidate.startLine,
      startColumn: 0,
      calleeKind: "bare",
      calleeName: candidate.calleeName,
      callerNodeKey: `${FILE_PATH}#caller`,
      resolutionClass: "proven",
      selectedTargetNodeKey: `targets.ts#${candidate.calleeName}`,
      confidence: null,
      resolver: "strict-proof",
      ruleSignature,
      dependencyFingerprint: "9".repeat(64),
      dependencies: [],
      verificationStatus: "unverified",
      verifiedTargetNodeKey: null,
      isStale: false,
      candidates: [],
    },
  };
}

async function resolveSites(
  fixture: ReturnType<typeof fixtureSites>,
  policy: NonNullable<
    Parameters<typeof resolveEdgesForLanguageBuckets>[1]["callResolutionCanary"]
  >,
): Promise<EdgeResolutionCallSite[]> {
  const callSites: EdgeResolutionCallSite[] = fixture.sites.map((site) => ({
    targetFunction: site.calleeName,
    startLine: site.startLine,
    startColumn: 0,
  }));
  let request: EdgeResolutionRequest | undefined;
  const provider: IEdgeResolutionProvider = {
    name: "q1-certification-test-provider",
    configure: () => undefined,
    checkAvailability: async () => ({ available: true }),
    resolveEdges: async (value): Promise<EdgeResolutionOutcome> => {
      request = value;
      return { edges: [], filesProcessed: value.files, filesFailed: [] };
    },
  };
  docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
    typescript: () => provider,
  }));

  const store = {
    projects: { getFirst: () => ({ id: 1 }) },
    callSites: {
      getForFiles: () => new Map([[FILE_PATH, callSites]]),
    },
    files: {
      getAllHashes: () => [
        { filePath: FILE_PATH, contentHash: fixture.sourceContentHash },
      ],
    },
    callSiteResolutions: {
      getForFile: () => fixture.sites.map((site) => site.resolution),
    },
  } as unknown as IGraphStore;
  const git = {
    listTrackedFilesWithBlobHash: async () => new Map<string, string>(),
    listUntrackedFiles: async () => [FILE_PATH],
    listModifiedFiles: async () => [],
  } as unknown as IGitProvider;

  await resolveEdgesForLanguageBuckets(
    { typescript: [{ file: FILE_PATH, commitSha: "test-head" }] },
    {
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git,
      callResolutionCanary: policy,
    },
  );

  return request?.callsByFile?.[FILE_PATH] ?? [];
}

function readShippedArtifact(): string {
  return fs.readFileSync(
    new URL(
      "../src/workflows/analyze/q1-named-import-candidate-certification.json",
      import.meta.url,
    ),
    "utf8",
  );
}
