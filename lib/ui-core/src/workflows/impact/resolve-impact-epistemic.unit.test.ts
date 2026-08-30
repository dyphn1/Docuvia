import { describe, it, expect } from "vitest";
import { EpistemicLevels, RiskLevels } from "@workspace/contracts";
import { resolveImpactEpistemic } from "./resolve-impact-epistemic.js";
import { IMPACT_MESSAGES } from "./impact-messages.js";

const FULL_COVERAGE = {
  workspaceFilesProcessed: 10,
  workspaceFilesTotal: 10,
};

describe("resolveImpactEpistemic()", () => {
  it("returns an exact verdict (all fields omitted) for a non-empty blast radius at full Tier B coverage", () => {
    expect(
      resolveImpactEpistemic({
        blastRadiusCount: 4,
        computedRiskLevel: RiskLevels.MEDIUM,
        ...FULL_COVERAGE,
        registryMediated: false,
      }),
    ).toEqual({ riskLevel: RiskLevels.MEDIUM });
  });

  describe("empty blast radius -> UNKNOWN, never a false-safe LOW", () => {
    it("overrides the computed band to UNKNOWN and explains the static-edges-only caveat when coverage is complete", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        ...FULL_COVERAGE,
        registryMediated: false,
      });

      expect(result.riskLevel).toBe(RiskLevels.UNKNOWN);
      expect(result.epistemic).toBe(EpistemicLevels.LOWER_BOUND);
      expect(result.riskNote).toBe(
        IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY,
      );
    });

    it("prioritizes the partial-coverage wording when Tier B ingestion is incomplete -- unknown, not zero", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        workspaceFilesProcessed: 3,
        workspaceFilesTotal: 10,
        registryMediated: false,
      });

      expect(result.riskLevel).toBe(RiskLevels.UNKNOWN);
      expect(result.epistemic).toBe(EpistemicLevels.LOWER_BOUND);
      expect(result.riskNote).toBe(
        IMPACT_MESSAGES.RISK_NOTE_EMPTY_WITH_PARTIAL_COVERAGE(3, 10),
      );
    });

    it("prioritizes the registry-mediated wording over the generic caveat when the target's file uses docuviaFactory/TOKENS", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        ...FULL_COVERAGE,
        registryMediated: true,
      });

      expect(result.riskLevel).toBe(RiskLevels.UNKNOWN);
      expect(result.riskNote).toBe(
        IMPACT_MESSAGES.REGISTRY_MEDIATED_COVERAGE_NOTE,
      );
    });

    it("treats unreadable coverage counts as incomplete -- never silently upgrades confidence", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        workspaceFilesProcessed: undefined,
        workspaceFilesTotal: undefined,
        registryMediated: false,
      });

      expect(result.riskLevel).toBe(RiskLevels.UNKNOWN);
      expect(result.epistemic).toBe(EpistemicLevels.LOWER_BOUND);
      expect(result.riskNote).toContain("UNKNOWN");
    });
  });

  describe("low own-file call resolution sharpens the empty-result note (issue #221 P2')", () => {
    const LOW_RESOLUTION = { resolved: 1, applicable: 10 };

    it("replaces the generic static-edges-only caveat when the target's own file resolved few of its call sites", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        ...FULL_COVERAGE,
        registryMediated: false,
        targetFileResolution: LOW_RESOLUTION,
      });

      expect(result.riskNote).toBe(
        IMPACT_MESSAGES.RISK_NOTE_EMPTY_LOW_RESOLUTION(1, 10),
      );
    });

    it("never overrides the partial-coverage or registry-mediated rungs (byte-stable existing wording)", () => {
      const partial = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        workspaceFilesProcessed: 3,
        workspaceFilesTotal: 10,
        registryMediated: false,
        targetFileResolution: LOW_RESOLUTION,
      });
      expect(partial.riskNote).toBe(
        IMPACT_MESSAGES.RISK_NOTE_EMPTY_WITH_PARTIAL_COVERAGE(3, 10),
      );

      const registry = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        ...FULL_COVERAGE,
        registryMediated: true,
        targetFileResolution: LOW_RESOLUTION,
      });
      expect(registry.riskNote).toBe(
        IMPACT_MESSAGES.REGISTRY_MEDIATED_COVERAGE_NOTE,
      );
    });

    it("ignores a below-min-sample file so one or two unresolved calls can't flip the verdict", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        ...FULL_COVERAGE,
        registryMediated: false,
        targetFileResolution: { resolved: 0, applicable: 2 },
      });

      expect(result.riskNote).toBe(
        IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY,
      );
    });

    it("degrades to the generic caveat when no resolution stats exist (absent = not sharper)", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 0,
        computedRiskLevel: RiskLevels.LOW,
        ...FULL_COVERAGE,
        registryMediated: false,
      });

      expect(result.riskNote).toBe(
        IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY,
      );
    });
  });

  describe("non-empty blast radius on a partially-ingested graph", () => {
    it("keeps the earned risk band but flags lower-bound with the partial-coverage note", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 7,
        computedRiskLevel: RiskLevels.HIGH,
        workspaceFilesProcessed: 3,
        workspaceFilesTotal: 10,
        registryMediated: false,
      });

      expect(result.riskLevel).toBe(RiskLevels.HIGH);
      expect(result.epistemic).toBe(EpistemicLevels.LOWER_BOUND);
      expect(result.riskNote).toBe(
        IMPACT_MESSAGES.RISK_NOTE_PARTIAL_COVERAGE_NON_EMPTY(3, 10),
      );
    });

    it("ignores registryMediated for non-empty results -- a real blast radius needs no registry hedge", () => {
      const result = resolveImpactEpistemic({
        blastRadiusCount: 2,
        computedRiskLevel: RiskLevels.MEDIUM,
        ...FULL_COVERAGE,
        registryMediated: true,
      });

      expect(result).toEqual({ riskLevel: RiskLevels.MEDIUM });
    });
  });
});
