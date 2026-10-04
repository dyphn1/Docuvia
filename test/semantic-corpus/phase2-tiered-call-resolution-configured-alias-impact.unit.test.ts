import { describe, expect, it } from "vitest";
import {
  assertFeaturePopulation,
  measureFeatureCandidateSets,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-configured-alias-impact.mjs";

describe("TRAIN/CAL configured alias impact measurement", () => {
  it("[happy] measures all sites including unscorable and empty candidate sets", () => {
    expect(
      measureFeatureCandidateSets([
        {
          keys: ["a", "b", "c"],
          mapped: ["gold", "gold", null],
          gold: ["gold"],
        },
        { keys: [], mapped: [], gold: [] },
      ]),
    ).toMatchObject({
      allSiteCount: 2,
      goldTargetOccurrences: 1,
      coveredGoldTargetOccurrences: 1,
      candidateRecall: 1,
      keyMemberships: 3,
      mappedMemberships: 1,
      keyZeroSites: 1,
      mappedZeroSites: 1,
      keySize: { p50: 0, p95: 3, max: 3 },
      mappedSize: { p50: 0, p95: 1, max: 1 },
    });
  });
  it("[invalid-input] rejects heldout splits and incomplete or duplicate populations", () => {
    expect(() =>
      assertFeaturePopulation(
        [{ sampleId: "one", split: "test" }],
        "train",
        new Set(["one"]),
      ),
    ).toThrow("TRAIN/CALIBRATION-only");
    expect(() =>
      assertFeaturePopulation(
        [
          { sampleId: "one", split: "train" },
          { sampleId: "one", split: "train" },
        ],
        "train",
        new Set(["one"]),
      ),
    ).toThrow("complete unique");
    expect(() =>
      assertFeaturePopulation([], "calibration", new Set(["one"])),
    ).toThrow("complete unique");
  });
  it("[error-handling] rejects mismatched key/mapping arrays", () => {
    expect(() =>
      measureFeatureCandidateSets([{ keys: ["one"], mapped: [], gold: [] }]),
    ).toThrow("one mapping per candidate key");
  });
});
