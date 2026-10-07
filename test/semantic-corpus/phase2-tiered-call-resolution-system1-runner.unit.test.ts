import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseOptions,
  systemOneRunnerImplementationHash,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mjs";

describe("P2-B runner provenance", () => {
  it("[happy] accepts calibration-frozen TRAIN family-transfer mode", () => {
    expect(
      parseOptions([
        "--mode",
        "family-transfer-calibrated-lofo",
        "--predictions",
        "predictions.jsonl",
        "--out",
        "output",
        "--freeze",
        "freeze.json",
      ]),
    ).toEqual({
      mode: "family-transfer-calibrated-lofo",
      predictionsPath: path.resolve("predictions.jsonl"),
      outputDirectory: path.resolve("output"),
      freezePath: path.resolve("freeze.json"),
    });
  });

  it("[invalid-input][error-handling] rejects unknown runner modes", () => {
    expect(() =>
      parseOptions([
        "--mode",
        "unknown",
        "--predictions",
        "predictions.jsonl",
        "--out",
        "output",
      ]),
    ).toThrow("Mode, source predictions, and output directory are required.");
  });

  it("[invalid-input][error-handling] requires freeze for heldout and calibrated LOFO modes", () => {
    expect(() =>
      parseOptions([
        "--mode",
        "heldout",
        "--predictions",
        "predictions.jsonl",
        "--out",
        "output",
      ]),
    ).toThrow("Calibration-frozen LOFO and heldout modes require --freeze.");
    expect(() =>
      parseOptions([
        "--mode",
        "family-transfer-calibrated-lofo",
        "--predictions",
        "predictions.jsonl",
        "--out",
        "output",
      ]),
    ).toThrow("Calibration-frozen LOFO and heldout modes require --freeze.");
    expect(() =>
      parseOptions([
        "--mode",
        "develop",
        "--predictions",
        "predictions.jsonl",
        "--out",
        "output",
        "--freeze",
        "freeze.json",
      ]),
    ).toThrow("Calibration-frozen LOFO and heldout modes require --freeze.");
  });

  it("[state-diff] fingerprints the exact runner source bytes", () => {
    const runnerRelativePath =
      "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts";
    const runnerPath = fileURLToPath(
      new URL(`../../${runnerRelativePath}`, import.meta.url),
    );
    const expected = createHash("sha256")
      .update(runnerRelativePath)
      .update("\0")
      .update(readFileSync(runnerPath))
      .update("\0")
      .digest("hex");

    expect(systemOneRunnerImplementationHash()).toBe(expected);
  });
});
