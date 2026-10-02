import { describe, expect, it } from "vitest";
import { assertSystem1CorpusManifestPin } from "./system1-eval-corpus-manifest.js";

describe("System-1 corpus manifest pin", () => {
  it("[happy] accepts the pinned path and byte hash", () => {
    const pin = {
      path: "../run-c/corpus-manifest.json",
      sha256: "a".repeat(64),
    };

    expect(() => assertSystem1CorpusManifestPin(pin, { ...pin })).not.toThrow();
  });

  it("[invalid-input] [error-handling] rejects a changed path or manifest hash", () => {
    const pin = {
      path: "../run-c/corpus-manifest.json",
      sha256: "a".repeat(64),
    };

    expect(() =>
      assertSystem1CorpusManifestPin(pin, {
        ...pin,
        sha256: "b".repeat(64),
      }),
    ).toThrow(/frozen policy pin/i);
    expect(() =>
      assertSystem1CorpusManifestPin(pin, {
        ...pin,
        path: "../other/corpus-manifest.json",
      }),
    ).toThrow(/frozen policy pin/i);
  });
});
