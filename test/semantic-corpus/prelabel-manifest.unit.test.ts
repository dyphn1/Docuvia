import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPrelabelManifest } from "../../scripts/semantic-corpus/prelabel-manifest.mts";

describe("source-only prelabel manifest", () => {
  it("[happy][state-diff] assigns deterministic duplicate-group splits and hashes", () => {
    const input = {
      corpusId: "cert-new-family",
      corpusVersion: "1",
      splitSeed: "sealed-seed",
      families: { "owner/new": "test" as const },
      samples: [
        {
          sampleId: "owner/new@rev::src/b.ts:4:2",
          family: "owner/new",
          duplicateGroup: "group-b",
          temporal: false,
        },
        {
          sampleId: "owner/new@rev::src/a.ts:2:1",
          family: "owner/new",
          duplicateGroup: "group-a",
          temporal: false,
        },
        {
          sampleId: "owner/new@rev::src/a-copy.ts:2:1",
          family: "owner/new",
          duplicateGroup: "group-a",
          temporal: false,
        },
      ],
    };

    const result = buildPrelabelManifest(input);
    const reordered = buildPrelabelManifest({
      ...input,
      samples: [...input.samples].reverse(),
    });

    expect(
      result.manifest.samples.map((row) => [row.sampleId, row.split]),
    ).toEqual([
      ["owner/new@rev::src/a-copy.ts:2:1", "test"],
      ["owner/new@rev::src/a.ts:2:1", "test"],
      ["owner/new@rev::src/b.ts:4:2", "test"],
    ]);
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifestSha256).toBe(reordered.manifestSha256);
    expect(result.splitHashes.test).toBe(
      createHash("sha256")
        .update(
          JSON.stringify([
            {
              sampleId: "owner/new@rev::src/a-copy.ts:2:1",
              duplicateGroup: "group-a",
            },
            {
              sampleId: "owner/new@rev::src/a.ts:2:1",
              duplicateGroup: "group-a",
            },
            {
              sampleId: "owner/new@rev::src/b.ts:4:2",
              duplicateGroup: "group-b",
            },
          ]),
        )
        .digest("hex"),
    );
    expect(result.splitHashes).toEqual(reordered.splitHashes);
  });

  it("[happy][invalid-input] excludes earlier temporal groups and rejects duplicate sample IDs", () => {
    const base = {
      corpusId: "cert-temporal",
      corpusVersion: "1",
      splitSeed: "sealed-seed",
      families: { "owner/nest": "test" as const },
    };
    const result = buildPrelabelManifest({
      ...base,
      samples: [
        {
          sampleId: "base@src/old.ts:0:0",
          family: "owner/nest",
          duplicateGroup: "unchanged",
          temporal: false,
        },
        {
          sampleId: "new@src/old.ts:0:0",
          family: "owner/nest",
          duplicateGroup: "unchanged",
          temporal: true,
        },
        {
          sampleId: "new@src/new.ts:0:0",
          family: "owner/nest",
          duplicateGroup: "novel",
          temporal: true,
        },
      ],
      priorGroups: new Map([["owner/nest", new Set(["unchanged"])]]),
    });

    expect(result.manifest.samples.map((row) => row.sampleId)).toEqual([
      "base@src/old.ts:0:0",
      "new@src/new.ts:0:0",
    ]);
    expect(result.dropped).toEqual([
      { sampleId: "new@src/old.ts:0:0", reason: "temporal-unchanged" },
    ]);
    expect(() =>
      buildPrelabelManifest({
        ...base,
        samples: [
          {
            sampleId: "duplicate",
            family: "owner/nest",
            duplicateGroup: "a",
            temporal: false,
          },
          {
            sampleId: "duplicate",
            family: "owner/nest",
            duplicateGroup: "b",
            temporal: false,
          },
        ],
      }),
    ).toThrow("Duplicate prelabel sample ID: duplicate");
  });

  it("[error-handling] rejects temporal samples outside a declared test family", () => {
    expect(() =>
      buildPrelabelManifest({
        corpusId: "bad-temporal",
        corpusVersion: "1",
        splitSeed: "seed",
        families: { "owner/nest": "train" },
        samples: [
          {
            sampleId: "new@src/new.ts:0:0",
            family: "owner/nest",
            duplicateGroup: "novel",
            temporal: true,
          },
        ],
      }),
    ).toThrow("Temporal snapshot of owner/nest must belong to a test family");
  });
});
