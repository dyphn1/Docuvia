import { describe, expect, it } from "vitest";
import type {
  AstDeclaredTypeOwner,
  CallResolutionCalibrationRecord,
  CallResolutionHypothesisRequest,
} from "@workspace/contracts";
import type { IndexedWorkspace } from "./call-resolution-hypothesis-index.js";
import type { CandidateWithoutRank } from "./call-resolution-hypothesis-internal.js";
import {
  decideResolution,
  rankCandidates,
} from "./call-resolution-hypothesis-ranking.js";

function rankedCandidate(
  peerMemberNames: readonly string[],
  targetMemberNames: readonly string[],
) {
  const candidate = {
    targetKey: "target-key",
    filePath: "src/target.ts",
    owner: { span: { start: 0 } } as AstDeclaredTypeOwner,
    memberName: "open",
    isStatic: false,
    declarations: [],
  } as unknown as CandidateWithoutRank;
  const request = {
    callerFilePath: "src/caller.ts",
    callSite: { peerMemberNames, argumentCount: null },
  } as CallResolutionHypothesisRequest;
  const workspace = {
    memberNamesByTargetKey: new Map([
      ["target-key", new Set(targetMemberNames)],
    ]),
  } as unknown as IndexedWorkspace;
  return rankCandidates([candidate], request, workspace, null)[0]!;
}

describe("ordered evidence v1 peer-member ranking", () => {
  it("[boundary] keeps partial peer overlap from adding uncalibrated rank weight", () => {
    expect(
      rankedCandidate(["open", "close", "flush"], ["open", "close"]),
    ).toMatchObject({ rankScore: 1, rankingSignals: ["same-directory"] });
    expect(rankedCandidate(["open", "close"], ["open"])).toMatchObject({
      rankScore: 1,
      rankingSignals: ["same-directory"],
    });
  });

  it("[happy] preserves the existing full same-binding peer evidence", () => {
    expect(rankedCandidate(["open", "close"], ["open", "close"])).toMatchObject(
      {
        rankScore: 21,
        rankingSignals: ["same-binding-peer-members", "same-directory"],
      },
    );
  });
});

describe("name-only exported candidates", () => {
  it("[invalid-input] does not accept a name-only target even when a signature is calibrated", () => {
    const candidate = {
      targetKey: "target-key",
      filePath: "src/target.ts",
      owner: { kind: "program", name: null, span: { start: 0, end: 0 } },
      memberName: "Module",
      isStatic: false,
      declarationSpans: [{ start: 0, end: 25 }],
      declarations: [
        {
          kind: "unknown",
          owner: { kind: "program" },
        },
      ],
      sourceLanguage: "typescript",
      inventoryComplete: false,
      rankScore: 1,
      rankingSignals: ["same-directory"],
    } as unknown as import("@workspace/contracts").CallResolutionHypothesisCandidate;

    expect(
      decideResolution([candidate], false, false, true, {
        thresholdScore: 0,
        confidenceLowerBound: 0.99,
      } as CallResolutionCalibrationRecord),
    ).toMatchObject({ status: "ambiguous", reason: "uncalibrated-signature" });
  });
});

describe("fail-closed resolution decisions", () => {
  it("[error-handling] abstains with a reason when no proposal survives or the list was truncated", () => {
    expect(decideResolution([], false, false, true, undefined)).toMatchObject({
      status: "ambiguous",
      selected: null,
      reason: "no-supported-candidates",
    });

    const candidate = {
      targetKey: "target-key",
      declarations: [{ kind: "function", owner: { kind: "program" } }],
      rankScore: 1,
    } as unknown as import("@workspace/contracts").CallResolutionHypothesisCandidate;
    expect(
      decideResolution([candidate], true, false, true, undefined),
    ).toMatchObject({
      status: "ambiguous",
      selected: null,
      reason: "candidate-list-truncated",
    });
  });
});
