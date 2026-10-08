import { describe, expect, it, vi } from "vitest";
import type {
  IGraphStore,
  SnapshotCallResolutionRow,
} from "@workspace/contracts";
import {
  getCallResolutionSummariesForEdge,
  getCurrentCallResolutionRows,
  toCallResolutionSummary,
  unknownCallResolution,
} from "./call-resolution-output.js";

function makeResolution(
  overrides: Partial<SnapshotCallResolutionRow> = {},
): SnapshotCallResolutionRow {
  return {
    callSiteKey: "src/caller.ts#4:8:open",
    identityVersion: 1,
    filePath: "src/caller.ts",
    sourceContentHash: "caller-hash",
    startLine: 4,
    startColumn: 8,
    calleeKind: "member",
    calleeName: "open",
    callerNodeKey: "src/caller.ts#run",
    projectionCallerNodeKey: "src/caller.ts#run",
    resolutionClass: "likely",
    selectedTargetNodeKey: "src/target.ts#open",
    confidence: 0.87,
    resolver: "typed-member-hypothesis",
    ruleSignature: "rule-v1",
    dependencyFingerprint: "deps-sha256",
    dependencies: [{ filePath: "src/target.ts", contentHash: "target-hash" }],
    verificationStatus: "unverified",
    verifiedTargetNodeKey: null,
    isStale: false,
    candidates: [
      {
        targetNodeKey: "src/target.ts#open",
        ordinal: 0,
        evidenceJson: '{"signal":"typed-receiver"}',
      },
      {
        targetNodeKey: "src/other.ts#open",
        ordinal: 1,
        evidenceJson: '{"signal":"same-name"}',
      },
      {
        targetNodeKey: "src/third.ts#open",
        ordinal: 2,
        evidenceJson: '{"signal":"import"}',
      },
      {
        targetNodeKey: "src/fourth.ts#open",
        ordinal: 3,
        evidenceJson: '{"signal":"neighbor"}',
      },
    ],
    ...overrides,
  };
}

describe("call-resolution output summaries", () => {
  it("[happy] keeps likely output to the selected target, confidence, and two alternatives", () => {
    expect(toCallResolutionSummary(makeResolution(), false)).toStrictEqual({
      callSiteKey: "src/caller.ts#4:8:open",
      resolutionClass: "likely",
      verificationStatus: "unverified",
      selectedTargetNodeKey: "src/target.ts#open",
      confidence: 0.87,
      isStale: false,
      alternatives: ["src/other.ts#open", "src/third.ts#open"],
      candidates: [],
    });
  });

  it("[positive] limits ambiguous output to the first three ordered candidates", () => {
    expect(
      toCallResolutionSummary(
        makeResolution({
          resolutionClass: "ambiguous",
          selectedTargetNodeKey: null,
          confidence: null,
        }),
        false,
      ),
    ).toStrictEqual({
      callSiteKey: "src/caller.ts#4:8:open",
      resolutionClass: "ambiguous",
      verificationStatus: "unverified",
      selectedTargetNodeKey: null,
      isStale: false,
      alternatives: [],
      candidates: [
        "src/target.ts#open",
        "src/other.ts#open",
        "src/third.ts#open",
      ],
    });
  });

  it("[positive] labels proven output and includes full evidence only when requested", () => {
    const row = makeResolution({
      resolutionClass: "proven",
      confidence: null,
    });
    const output = toCallResolutionSummary(row, true);
    expect(output).toStrictEqual({
      callSiteKey: "src/caller.ts#4:8:open",
      resolutionClass: "proven",
      verificationStatus: "unverified",
      selectedTargetNodeKey: "src/target.ts#open",
      evidenceLabel: "static-proof",
      isStale: false,
      alternatives: [],
      candidates: [],
      evidence: row,
    });
  });

  it("[positive] labels a matching Tier B target as verified", () => {
    expect(
      toCallResolutionSummary(
        makeResolution({
          verificationStatus: "verified",
          verifiedTargetNodeKey: "src/target.ts#open",
        }),
        false,
      ),
    ).toStrictEqual({
      callSiteKey: "src/caller.ts#4:8:open",
      resolutionClass: "likely",
      verificationStatus: "verified",
      selectedTargetNodeKey: "src/target.ts#open",
      confidence: 0.87,
      evidenceLabel: "tier-b-verified",
      isStale: false,
      alternatives: ["src/other.ts#open", "src/third.ts#open"],
      candidates: [],
    });
  });

  it("[positive] retains bounded ambiguous candidates when a candidate is verified", () => {
    expect(
      toCallResolutionSummary(
        makeResolution({
          resolutionClass: "ambiguous",
          verificationStatus: "verified",
          verifiedTargetNodeKey: "src/target.ts#open",
          confidence: null,
        }),
        false,
      ),
    ).toStrictEqual({
      callSiteKey: "src/caller.ts#4:8:open",
      resolutionClass: "ambiguous",
      verificationStatus: "verified",
      selectedTargetNodeKey: "src/target.ts#open",
      evidenceLabel: "tier-b-verified",
      isStale: false,
      alternatives: [],
      candidates: [
        "src/target.ts#open",
        "src/other.ts#open",
        "src/third.ts#open",
      ],
    });
  });

  it("[negative] degrades stale evidence to unknown and hides its former selection", () => {
    expect(
      toCallResolutionSummary(
        makeResolution({
          isStale: true,
          resolutionClass: "proven",
          confidence: null,
        }),
        false,
      ),
    ).toStrictEqual({
      callSiteKey: "src/caller.ts#4:8:open",
      resolutionClass: "unknown",
      verificationStatus: "unknown",
      selectedTargetNodeKey: null,
      isStale: true,
      alternatives: [],
      candidates: [],
    });
  });

  it("[negative] reports an edge without per-site certainty as unknown", () => {
    expect(unknownCallResolution()).toStrictEqual({
      callSiteKey: null,
      resolutionClass: "unknown",
      verificationStatus: "unknown",
      selectedTargetNodeKey: null,
      isStale: false,
      alternatives: [],
      candidates: [],
    });
  });

  it("[invalid-input] degrades missing caller identity to an unknown edge", () => {
    expect(
      getCallResolutionSummariesForEdge(
        {} as IGraphStore,
        undefined,
        "src/target.ts#open",
      ),
    ).toStrictEqual([unknownCallResolution()]);
  });

  it("[performance] reads only exact edge rows when targeted lookup is available", () => {
    const row = makeResolution();
    const getForProjectionEdge = vi.fn(() => [row]);
    const getAllForProject = vi.fn(() => [row]);
    const store = {
      projects: { getFirst: () => ({ id: 42 }) },
      meta: { get: () => undefined },
      callSiteResolutions: { getForProjectionEdge, getAllForProject },
    } as unknown as IGraphStore;

    expect(
      getCallResolutionSummariesForEdge(
        store,
        "src/caller.ts#run",
        "src/target.ts#open",
      ),
    ).toStrictEqual([toCallResolutionSummary(row, false)]);
    expect(getForProjectionEdge).toHaveBeenCalledWith(
      42,
      "src/caller.ts#run",
      "src/target.ts#open",
    );
    expect(getAllForProject).not.toHaveBeenCalled();
  });

  it("[negative] keeps an edge without an exact row unknown on targeted lookup", () => {
    const getForProjectionEdge = vi.fn(() => []);
    const getAllForProject = vi.fn(() => [makeResolution()]);
    const store = {
      projects: { getFirst: () => ({ id: 42 }) },
      meta: { get: () => undefined },
      callSiteResolutions: { getForProjectionEdge, getAllForProject },
    } as unknown as IGraphStore;

    expect(
      getCallResolutionSummariesForEdge(
        store,
        "src/caller.ts#run",
        "src/target.ts#open",
      ),
    ).toStrictEqual([unknownCallResolution()]);
    expect(getAllForProject).not.toHaveBeenCalled();
  });

  it("[error-handling] returns no rows when the optional resolution repository is absent", () => {
    const store = {
      projects: { getFirst: () => ({ id: 42 }) },
    } as unknown as IGraphStore;

    expect(getCurrentCallResolutionRows(store)).toStrictEqual([]);
  });
});
