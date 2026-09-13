import { describe, expect, it } from "vitest";
import {
  DynamicDependencyKinds,
  DynamicDependencyStatuses,
  EpistemicLevels,
  RiskLevels,
  type DynamicDependencyEvidence,
} from "@workspace/contracts";
import { resolveImpactEpistemic } from "./resolve-impact-epistemic.js";

// TDD-SOURCE: https://github.com/dyphn1/Docuvia/issues/393

const evidence: DynamicDependencyEvidence = {
  sourceFile: "src/plugin-loader.ts",
  kind: DynamicDependencyKinds.DYNAMIC_IMPORT,
  expression: "`./plugins/${pluginName}`",
  startLine: 7,
  startColumn: 20,
  literalPrefix: "./plugins/",
  literalSuffix: "",
  status: DynamicDependencyStatuses.BOUNDED,
  candidatePaths: ["src/plugins/cleanup-plugin.ts"],
  reason: "bounded-local-pattern",
};

function completeCoverage() {
  return {
    workspaceFilesProcessed: 10,
    workspaceFilesTotal: 10,
    registryMediated: false,
  } as const;
}

describe("issue #393 dynamic impact epistemics", () => {
  it("keeps zero confirmed dependents UNKNOWN even when a bounded candidate is displayed", () => {
    const result = resolveImpactEpistemic({
      blastRadiusCount: 0,
      computedRiskLevel: RiskLevels.LOW,
      ...completeCoverage(),
      dynamicEvidence: [evidence],
    });

    expect(result.riskLevel).toBe(RiskLevels.UNKNOWN);
    expect(result.epistemic).toBe(EpistemicLevels.LOWER_BOUND);
    expect(result.riskNote).toContain("src/plugin-loader.ts:8");
    expect(result.riskNote).toContain("bounded-local-pattern");
    expect(result.riskNote).toContain(
      "possible targets, not confirmed runtime edges",
    );
  });

  it("marks a non-empty confirmed result lower-bound when dynamic evidence can add dependents", () => {
    const result = resolveImpactEpistemic({
      blastRadiusCount: 1,
      computedRiskLevel: RiskLevels.MEDIUM,
      ...completeCoverage(),
      dynamicEvidence: [evidence],
    });

    expect(result).toEqual({
      riskLevel: RiskLevels.MEDIUM,
      epistemic: EpistemicLevels.LOWER_BOUND,
      riskNote: expect.stringContaining("runtime dependency evidence"),
    });
  });

  it("preserves the exact result when coverage is complete and no runtime evidence exists", () => {
    expect(
      resolveImpactEpistemic({
        blastRadiusCount: 1,
        computedRiskLevel: RiskLevels.MEDIUM,
        ...completeCoverage(),
        dynamicEvidence: [],
      }),
    ).toEqual({ riskLevel: RiskLevels.MEDIUM });
  });

  it("keeps partial workspace coverage higher-priority than the dynamic-evidence note", () => {
    const result = resolveImpactEpistemic({
      blastRadiusCount: 1,
      computedRiskLevel: RiskLevels.MEDIUM,
      workspaceFilesProcessed: 5,
      workspaceFilesTotal: 10,
      registryMediated: false,
      dynamicEvidence: [evidence],
    });

    expect(result.epistemic).toBe(EpistemicLevels.LOWER_BOUND);
    expect(result.riskNote).toContain("5 of 10 workspace files");
  });
});
