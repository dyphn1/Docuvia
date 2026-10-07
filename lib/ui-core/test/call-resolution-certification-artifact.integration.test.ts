import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isRuleSignatureCertified,
  loadCallResolutionCertificationArtifact,
} from "../src/workflows/analyze/call-resolution-certification.js";
import type { ExpectedCertificationInputs } from "../src/workflows/analyze/call-resolution-certification.js";

const artifactPath = fileURLToPath(
  new URL(
    "../../../docs/gitbook/analysis/tiered-call-resolution-certification-q1-recert-evidence/q1-named-import-candidate-certification.json",
    import.meta.url,
  ),
);
const rawArtifact = readFileSync(artifactPath, "utf8");
const expected = {
  artifactSha256:
    "c81a6de05c1cd954f33238f160ac45cbcf0368fee1efec6fa693f67c825e651f",
  implementationCommitSha: "8013b99b1410f1302c576178e557c4484735077a",
  ruleConfigurationSha256:
    "96d314c147163bed22286b1116941a43c2065ed6d644bff8f77b2e449e9de728",
  oracleIdentity: "typescript-language-server",
  oracleVersion: "5.3.0+tsserver@5.9.3",
  oracleConfigurationSha256:
    "032d80801a24de4e55c32cf1d0c0df189281dfb6f44f0a366be4d76451fd627e",
  corpusManifestSha256:
    "597e2415b5d15d4098daadc072f6c128633dd3780e8ba54f552efc26ce64bdd2",
  newFamily: {
    familyId: "microsoft/vscode",
    revision: "4f2dfc552c95b9ff4729fa13f109bfda5f886d69",
    splitSha256:
      "371fa0e87a6e1f6f1884d5fa67d5b28adb2a638a1bafff7007cb9e7ddb8d1ecb",
  },
  temporal: {
    familyId: "dyphn1/Docuvia",
    revision: "113a2afe97d2407d0b6ba19624f42408875831cf",
    baseRevision: "204c40fb7080ebded011f65a3dae7d749cce9ed1",
    splitSha256:
      "53a6864ffeab9bd3e8c9aae2f005a40b3914b7fb22fac0292aea6bd1f9abe1f0",
  },
} satisfies ExpectedCertificationInputs;

function artifactHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

describe("Q1 candidate certification artifact", () => {
  it("[happy] loads the frozen file and trusts the passing Q1 signature", () => {
    const decision = loadCallResolutionCertificationArtifact(
      rawArtifact,
      expected,
    );

    expect(decision.status).toBe("loaded");
    expect(decision.artifactSha256).toBe(expected.artifactSha256);
    expect(decision.certifiedRuleSignatures).toEqual(["q1:named-import:v1"]);
    expect(isRuleSignatureCertified(decision, "q1:named-import:v1")).toBe(true);
  });

  it("[invalid-input] rejects a mismatched trusted rule-configuration pin", () => {
    const decision = loadCallResolutionCertificationArtifact(rawArtifact, {
      ...expected,
      ruleConfigurationSha256: "0".repeat(64),
    });

    expect(decision.status).toBe("rejected");
    expect(decision.certifiedRuleSignatures).toEqual([]);
  });

  it("[error-handling] rejects malformed artifact JSON with a matching byte pin", () => {
    const malformed = "{";
    const decision = loadCallResolutionCertificationArtifact(malformed, {
      ...expected,
      artifactSha256: artifactHash(malformed),
    });

    expect(decision.status).toBe("rejected");
    expect(decision.rejectionReasons).toContain(
      "artifact schema or JSON is invalid",
    );
  });

  it("[stress] returns a stable trusted decision across repeated file loads", () => {
    const decisions = Array.from({ length: 100 }, () =>
      loadCallResolutionCertificationArtifact(rawArtifact, expected),
    );

    expect(decisions.every((decision) => decision.status === "loaded")).toBe(
      true,
    );
    expect(
      new Set(
        decisions.map((decision) => decision.certifiedRuleSignatures.join(",")),
      ).size,
    ).toBe(1);
  });

  it("[state-diff] certifies only Q1 while Q2 and receiver signatures remain absent", () => {
    const decision = loadCallResolutionCertificationArtifact(
      rawArtifact,
      expected,
    );

    expect(isRuleSignatureCertified(decision, "q1:named-import:v1")).toBe(true);
    expect(isRuleSignatureCertified(decision, "q2:reexport-trace:v1")).toBe(
      false,
    );
    expect(isRuleSignatureCertified(decision, "q3:typed-receiver:v1")).toBe(
      false,
    );
    expect(decision.certifiedRuleSignatures).toEqual(["q1:named-import:v1"]);
  });
});
