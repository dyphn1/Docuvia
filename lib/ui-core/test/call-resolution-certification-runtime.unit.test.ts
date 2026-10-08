import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isRuleSignatureCertified,
  loadQ1NamedImportCertificationArtifact,
  loadShippedQ1NamedImportCertificationArtifact,
} from "../src/workflows/analyze/call-resolution-certification.js";

const rawArtifact = readFileSync(
  new URL(
    "../src/workflows/analyze/q1-named-import-candidate-certification.json",
    import.meta.url,
  ),
  "utf8",
);
const FROZEN_Q1_RULE_CONFIGURATION_SHA256 =
  "5f3e8c9dae8ed1c3c850b533f735813b212e0f286ef7ca91b6ad61cf7b926c9a";

describe("shipped Q1 call-resolution certification", () => {
  it("[happy] trusts only the pinned Q1 named-import signature at its certified source hash", () => {
    const decision = loadQ1NamedImportCertificationArtifact(
      rawArtifact,
      FROZEN_Q1_RULE_CONFIGURATION_SHA256,
    );

    expect(decision.status).toBe("loaded");
    expect(isRuleSignatureCertified(decision, "q1:named-import:v1")).toBe(true);
    expect(isRuleSignatureCertified(decision, "q2:reexport-trace:v1")).toBe(
      false,
    );
  });

  it("[state-diff] trusts the shipped Q1 artifact against this branch's rule source", () => {
    const decision = loadShippedQ1NamedImportCertificationArtifact();

    expect(decision.status).toBe("loaded");
    expect(decision.rejectionReasons).toEqual([]);
    expect(decision.certifiedRuleSignatures).toEqual(["q1:named-import:v1"]);
    expect(isRuleSignatureCertified(decision, "q1:named-import:v1")).toBe(true);
  });

  it("[invalid-input] rejects changed bytes and a changed Q1 rule hash", () => {
    const tampered = loadQ1NamedImportCertificationArtifact(`${rawArtifact} `);
    const changedRules = loadQ1NamedImportCertificationArtifact(
      rawArtifact,
      "0".repeat(64),
    );

    expect(tampered.status).toBe("rejected");
    expect(tampered.certifiedRuleSignatures).toEqual([]);
    expect(changedRules.status).toBe("rejected");
    expect(changedRules.certifiedRuleSignatures).toEqual([]);
  });

  it("[error-handling] treats absent artifact bytes as missing and grants no skip authority", () => {
    const decision = loadQ1NamedImportCertificationArtifact(undefined);

    expect(decision.status).toBe("missing");
    expect(decision.certifiedRuleSignatures).toEqual([]);
    expect(isRuleSignatureCertified(decision, "q1:named-import:v1")).toBe(
      false,
    );
  });
});
