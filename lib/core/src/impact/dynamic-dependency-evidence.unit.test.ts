import { describe, expect, it } from "vitest";
import {
  DynamicDependencyKinds,
  DynamicDependencyStatuses,
  type DynamicDependencyEvidence,
} from "@workspace/contracts";
import { scannedFromEvidence } from "./dynamic-dependency-evidence.js";

// TDD-SOURCE: https://github.com/dyphn1/Docuvia/issues/263
// TDD-SOURCE: issue #508 Phase 2 AC4
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md

const evidence: DynamicDependencyEvidence = {
  sourceFile: "src/plugin-loader.ts",
  kind: DynamicDependencyKinds.DYNAMIC_IMPORT,
  expression: "`./plugins/${pluginName}",
  startLine: 1,
  startColumn: 15,
  literalPrefix: "./plugins/",
  literalSuffix: "",
  status: DynamicDependencyStatuses.BOUNDED,
  candidatePaths: ["src/plugins/alpha.ts"],
  reason: "bounded-local-pattern",
};

describe("dynamic dependency evidence reconstruction", () => {
  it("[invalid-input] does not mark an unterminated template expression interpolated (#508 D3)", () => {
    expect(scannedFromEvidence(evidence).interpolated).toBe(false);
  });

  it("[happy] marks a closed template expression with interpolation as interpolated (#508 D3)", () => {
    expect(
      scannedFromEvidence({
        ...evidence,
        expression: "`./plugins/${pluginName}`",
      }).interpolated,
    ).toBe(true);
  });

  it("[error-handling] treats a non-template persisted expression as non-interpolated (#508 D3)", () => {
    expect(
      scannedFromEvidence({ ...evidence, expression: "pluginName" })
        .interpolated,
    ).toBe(false);
  });
});
