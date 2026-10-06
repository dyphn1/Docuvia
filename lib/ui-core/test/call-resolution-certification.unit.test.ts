import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  isRuleSignatureCertified,
  loadCallResolutionCertificationArtifact,
  type CallResolutionCertificationArtifact,
  type ExpectedCertificationInputs,
} from "../src/workflows/analyze/call-resolution-certification.js";

const frozenInputs: ExpectedCertificationInputs = {
  artifactSha256: "",
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

function certifiedTrack(): CallResolutionCertificationArtifact["signatures"][number]["newFamily"] {
  return {
    eligibleDuplicateGroups: 350,
    uniquelyResolvedGroups: 299,
    successfulGroups: 299,
    contradictionGroups: 0,
    lowerBound95: 0.05 ** (1 / 299),
  };
}

function artifactBytes(): string {
  const artifact: CallResolutionCertificationArtifact = {
    schemaVersion: CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
    policyVersion: "sha256-callsite-rule-v2",
    frozenAt: "2026-01-01T00:00:00.000Z",
    labelsOpenedAt: "2026-01-02T00:00:00.000Z",
    resultsRecordedAt: "2026-01-03T00:00:00.000Z",
    inputs: {
      implementationCommitSha: frozenInputs.implementationCommitSha,
      ruleConfigurationSha256: frozenInputs.ruleConfigurationSha256,
      oracleIdentity: frozenInputs.oracleIdentity,
      oracleVersion: frozenInputs.oracleVersion,
      oracleConfigurationSha256: frozenInputs.oracleConfigurationSha256,
      corpusManifestSha256: frozenInputs.corpusManifestSha256,
      newFamily: frozenInputs.newFamily,
      temporal: frozenInputs.temporal,
    },
    signatures: [
      {
        ruleSignature: "strict-proof-v1",
        newFamily: certifiedTrack(),
        temporal: certifiedTrack(),
      },
    ],
  };
  return JSON.stringify(artifact);
}

function parsedArtifact(): CallResolutionCertificationArtifact {
  return JSON.parse(artifactBytes()) as CallResolutionCertificationArtifact;
}

function expectedFor(raw: string): ExpectedCertificationInputs {
  return {
    ...frozenInputs,
    artifactSha256: createHash("sha256").update(raw).digest("hex"),
  };
}

describe("one-shot call-resolution certification artifact", () => {
  it("[happy][state-diff] certifies a signature only when both frozen tracks clear the group gate", () => {
    const raw = artifactBytes();
    const decision = loadCallResolutionCertificationArtifact(
      raw,
      expectedFor(raw),
    );

    expect(decision).toMatchObject({ status: "loaded", rejectionReasons: [] });
    expect(decision.certifiedRuleSignatures).toEqual(["strict-proof-v1"]);
  });

  it("[invalid-input][error-handling] returns an empty decision without an external artifact pin", () => {
    const raw = artifactBytes();
    const expected = { ...expectedFor(raw), artifactSha256: "" };
    const decision = loadCallResolutionCertificationArtifact(raw, expected);

    expect(decision.status).toBe("missing");
    expect(decision.certifiedRuleSignatures).toEqual([]);
    expect(decision.rejectionReasons).toContain(
      "trusted artifact SHA-256 pin is missing or malformed",
    );
  });

  it("[invalid-input][state-diff] rejects artifact bytes changed after the external pin was set", () => {
    const pinnedBytes = artifactBytes();
    const changedBytes = pinnedBytes.replace(
      "commit-temporal-newer",
      "commit-temporal-edited",
    );
    const decision = loadCallResolutionCertificationArtifact(
      changedBytes,
      expectedFor(pinnedBytes),
    );

    expect(decision.status).toBe("rejected");
    expect(decision.certifiedRuleSignatures).toEqual([]);
    expect(decision.rejectionReasons).toContain(
      "artifact SHA-256 does not match trusted pin",
    );
  });

  it("[invalid-input][state-diff] rejects a freeze recorded after labels were opened", () => {
    const artifact = parsedArtifact();
    artifact.frozenAt = "2026-01-04T00:00:00.000Z";
    const raw = JSON.stringify(artifact);
    const decision = loadCallResolutionCertificationArtifact(
      raw,
      expectedFor(raw),
    );

    expect(decision.status).toBe("rejected");
    expect(decision.certifiedRuleSignatures).toEqual([]);
  });

  it("[invalid-input][state-diff] rejects rule, oracle, corpus and track hash mismatches", () => {
    const raw = artifactBytes();
    const expected = expectedFor(raw);
    const decision = loadCallResolutionCertificationArtifact(raw, {
      ...expected,
      implementationCommitSha: "0".repeat(40),
      ruleConfigurationSha256: "1".repeat(64),
      oracleConfigurationSha256: "2".repeat(64),
      oracleIdentity: "other-language-server",
      oracleVersion: "6.0.0",
      corpusManifestSha256: "3".repeat(64),
      newFamily: { ...expected.newFamily, splitSha256: "5".repeat(64) },
      temporal: { ...expected.temporal, splitSha256: "4".repeat(64) },
    });

    expect(decision.status).toBe("rejected");
    expect(decision.certifiedRuleSignatures).toEqual([]);
  });

  it("[invalid-input][state-diff] requires both independent tracks to clear 299 groups, zero errors and the exact bound", () => {
    const underSupported = parsedArtifact();
    underSupported.signatures[0].newFamily = {
      ...certifiedTrack(),
      eligibleDuplicateGroups: 298,
      uniquelyResolvedGroups: 298,
      successfulGroups: 298,
      lowerBound95: 0.05 ** (1 / 298),
    };
    const underSupportedBytes = JSON.stringify(underSupported);
    const underSupportedDecision = loadCallResolutionCertificationArtifact(
      underSupportedBytes,
      expectedFor(underSupportedBytes),
    );
    expect(underSupportedDecision.certifiedRuleSignatures).toEqual([]);
    expect(
      underSupportedDecision.unpromotedSignatures[0].newFamilyReasons,
    ).toContain("track has fewer than 299 successful independent groups");

    const temporalUnderSupported = parsedArtifact();
    temporalUnderSupported.signatures[0].temporal = {
      ...certifiedTrack(),
      eligibleDuplicateGroups: 298,
      uniquelyResolvedGroups: 298,
      successfulGroups: 298,
      lowerBound95: 0.05 ** (1 / 298),
    };
    const temporalUnderSupportedBytes = JSON.stringify(temporalUnderSupported);
    const temporalUnderSupportedDecision =
      loadCallResolutionCertificationArtifact(
        temporalUnderSupportedBytes,
        expectedFor(temporalUnderSupportedBytes),
      );
    expect(temporalUnderSupportedDecision.certifiedRuleSignatures).toEqual([]);
    expect(
      temporalUnderSupportedDecision.unpromotedSignatures[0].temporalReasons,
    ).toContain("track has fewer than 299 successful independent groups");

    const contradicted = parsedArtifact();
    contradicted.signatures[0].temporal = {
      ...certifiedTrack(),
      uniquelyResolvedGroups: 299,
      successfulGroups: 298,
      contradictionGroups: 1,
      lowerBound95: 0.05 ** (1 / 298),
    };
    const contradictedBytes = JSON.stringify(contradicted);
    const contradictedDecision = loadCallResolutionCertificationArtifact(
      contradictedBytes,
      expectedFor(contradictedBytes),
    );
    expect(contradictedDecision.certifiedRuleSignatures).toEqual([]);

    const overstatedBound = parsedArtifact();
    overstatedBound.signatures[0].newFamily.lowerBound95 = 0.999;
    const overstatedBytes = JSON.stringify(overstatedBound);
    const overstatedDecision = loadCallResolutionCertificationArtifact(
      overstatedBytes,
      expectedFor(overstatedBytes),
    );
    expect(overstatedDecision.certifiedRuleSignatures).toEqual([]);
  });

  it("[invalid-input][error-handling] does not trust a caller-built signature Set", () => {
    const forgedDecision = {
      artifactSha256: "a".repeat(64),
      status: "loaded",
      certifiedRuleSignatures: new Set(["strict-proof-v1"]),
      rejectionReasons: [],
    };

    expect(isRuleSignatureCertified(forgedDecision, "strict-proof-v1")).toBe(
      false,
    );
  });
});
