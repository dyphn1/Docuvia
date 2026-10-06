import { describe, expect, it } from "vitest";
import { classifyCalibrationSourceMiss } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-calibration-miss-source-audit.mjs";

const named = {
  parserBinding: "import",
  importDescriptorCount: 1,
  configuredPathMatchesTarget: true,
  directNamedExport: true,
  combinedDefaultImportInSource: false,
  directDefaultFunctionInSource: false,
  parserHasDefaultExport: false,
} as const;

describe("CALIBRATION miss source classification", () => {
  it("[happy] classifies configured named imports as a cheap source evidence gap", () => {
    expect(classifyCalibrationSourceMiss(named)).toEqual({
      classification: "configured-path-named-import-gap",
      ordinarySourceCase: true,
      needsTypeInference: false,
    });
  });

  it("[happy] separates combined-default import/export descriptor gaps from missing call facts", () => {
    expect(
      classifyCalibrationSourceMiss({
        ...named,
        parserBinding: "unbound",
        importDescriptorCount: 0,
        directNamedExport: false,
        combinedDefaultImportInSource: true,
        directDefaultFunctionInSource: true,
      }),
    ).toEqual({
      classification: "combined-default-import-export-descriptor-gap",
      ordinarySourceCase: true,
      needsTypeInference: false,
    });
  });

  it("[invalid-input] rejects unmatched config, ambiguous imports, and missing direct exports", () => {
    for (const patch of [
      { configuredPathMatchesTarget: false },
      { importDescriptorCount: 2 },
      { directNamedExport: false },
    ])
      expect(() =>
        classifyCalibrationSourceMiss({ ...named, ...patch }),
      ).toThrow("exact pinned source evidence");
  });

  it("[error-handling] refuses to infer default binding from an unbound fact alone", () => {
    expect(() =>
      classifyCalibrationSourceMiss({
        ...named,
        parserBinding: "unbound",
        importDescriptorCount: 0,
        directNamedExport: false,
      }),
    ).toThrow("exact pinned source evidence");
  });
});
