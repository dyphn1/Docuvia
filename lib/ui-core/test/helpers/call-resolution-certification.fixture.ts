import { createHash } from "node:crypto";
import {
  CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  loadCallResolutionCertificationArtifact,
  type CallResolutionCertificationArtifact,
} from "../../src/workflows/analyze/call-resolution-certification.js";

const inputHashes = {
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

function passingTrack(): CallResolutionCertificationArtifact["signatures"][number]["newFamily"] {
  return {
    eligibleDuplicateGroups: 299,
    uniquelyResolvedGroups: 299,
    successfulGroups: 299,
    contradictionGroups: 0,
    lowerBound95: 0.05 ** (1 / 299),
  };
}

export function createTestCertificationDecision(
  ruleSignatures: readonly string[],
) {
  const artifact: CallResolutionCertificationArtifact = {
    schemaVersion: CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
    policyVersion: "sha256-callsite-rule-class-v1",
    frozenAt: "2026-01-01T00:00:00.000Z",
    labelsOpenedAt: "2026-01-02T00:00:00.000Z",
    resultsRecordedAt: "2026-01-03T00:00:00.000Z",
    inputs: inputHashes,
    signatures: ruleSignatures.map((ruleSignature) => ({
      ruleSignature,
      newFamily: passingTrack(),
      temporal: passingTrack(),
    })),
  };
  const rawArtifact = JSON.stringify(artifact);
  return loadCallResolutionCertificationArtifact(rawArtifact, {
    ...inputHashes,
    artifactSha256: createHash("sha256").update(rawArtifact).digest("hex"),
  });
}
