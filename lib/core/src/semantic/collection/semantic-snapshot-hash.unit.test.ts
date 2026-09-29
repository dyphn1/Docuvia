import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorCodes } from "@workspace/contracts";
import { isSnapshotPath, snapshotHash } from "./semantic-snapshot-hash.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-01--snapshot-identity
const sha = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("semantic snapshot hash", () => {
  it("[happy] hashes sorted path/content lines from byte hashes", () => {
    const entries = [
      { path: "src/b.ts", sha256: sha("b") },
      { path: "src/a.ts", sha256: sha("a") },
    ];
    const expected = sha(`src/a.ts\0${sha("a")}\nsrc/b.ts\0${sha("b")}\n`);
    expect(snapshotHash(entries)).toBe(expected);
    expect(snapshotHash([...entries].reverse())).toBe(expected);
  });

  it("[state-diff] any content or path change changes the hash", () => {
    const base = [{ path: "src/a.ts", sha256: sha("a") }];
    const hash = snapshotHash(base);
    expect(snapshotHash([{ path: "src/a.ts", sha256: sha("a2") }])).not.toBe(
      hash,
    );
    expect(snapshotHash([{ path: "src/c.ts", sha256: sha("a") }])).not.toBe(
      hash,
    );
    expect(
      snapshotHash([...base, { path: "tsconfig.json", sha256: sha("{}") }]),
    ).not.toBe(hash);
  });

  it("[boundary] selects TS/JS sources and project config files only", () => {
    for (const path of [
      "a.ts",
      "b/c.tsx",
      "d.mts",
      "e.cts",
      "f.js",
      "g.jsx",
      "h.mjs",
      "i.cjs",
      "tsconfig.json",
      "pkg/tsconfig.build.json",
      "jsconfig.json",
      "pkg/package.json",
    ])
      expect(isSnapshotPath(path)).toBe(true);
    for (const path of ["README.md", "a.d.ts.map", "x.json", "tsconfig.yaml"])
      expect(isSnapshotPath(path)).toBe(false);
  });

  it("[invalid-input] rejects malformed digests and duplicate paths", () => {
    const code = { code: ErrorCodes.SEMANTIC_CORPUS_INVALID };
    expect(() => snapshotHash([{ path: "a.ts", sha256: "ABC" }])).toThrow(
      expect.objectContaining(code),
    );
    expect(() =>
      snapshotHash([
        { path: "a.ts", sha256: sha("a") },
        { path: "a.ts", sha256: sha("b") },
      ]),
    ).toThrow(expect.objectContaining(code));
  });

  it("[error-handling] an empty snapshot is rejected rather than hashed", () => {
    expect(() => snapshotHash([])).toThrow(
      expect.objectContaining({ code: ErrorCodes.SEMANTIC_CORPUS_INVALID }),
    );
  });
});
