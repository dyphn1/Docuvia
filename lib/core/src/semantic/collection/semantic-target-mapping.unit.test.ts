import { describe, expect, it } from "vitest";
import type {
  SemanticDeclarationRef,
  SemanticOracleAnswer,
} from "@workspace/contracts";
import {
  mapDeclarationToNodeKey,
  oracleOutcome,
} from "./semantic-target-mapping.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-03--target-identity
// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-05--lsp-oracle
const decl = (
  filePath: string,
  name: string,
  extra: Partial<SemanticDeclarationRef> = {},
): SemanticDeclarationRef => ({
  filePath,
  name,
  startLine: 10,
  nameLine: 11,
  concrete: true,
  ...extra,
});
const keys = new Set([
  "src/a.ts#run",
  "src/a.ts#run@L20",
  "src/a.ts#Runner.go",
  "src/b.ts#Box.open@L11",
  "src/b.ts#Box.open",
]);
const at = (
  declaration: SemanticDeclarationRef | null,
  filePath = declaration?.filePath ?? "x.ts",
  external = false,
) => ({ external, filePath, declaration });

describe("target identity mapping", () => {
  it("[happy] maps qualified and plain declarations to existing node keys", () => {
    expect(mapDeclarationToNodeKey(decl("src/a.ts", "run"), keys)).toBe(
      "src/a.ts#run",
    );
    expect(
      mapDeclarationToNodeKey(
        decl("src/a.ts", "go", { containerName: "Runner" }),
        keys,
      ),
    ).toBe("src/a.ts#Runner.go");
  });

  it("[boundary] prefers the line-disambiguated key for start line, then name line", () => {
    expect(
      mapDeclarationToNodeKey(decl("src/a.ts", "run", { startLine: 20 }), keys),
    ).toBe("src/a.ts#run@L20");
    expect(
      mapDeclarationToNodeKey(
        decl("src/b.ts", "open", { containerName: "Box", startLine: 9 }),
        keys,
      ),
    ).toBe("src/b.ts#Box.open@L11");
  });

  it("[negative] a declaration with no graph node is unmappable", () => {
    expect(mapDeclarationToNodeKey(decl("src/c.ts", "run"), keys)).toBe(
      undefined,
    );
    expect(
      mapDeclarationToNodeKey(
        decl("src/a.ts", "go", { containerName: "Other" }),
        keys,
      ),
    ).toBe(undefined);
  });
});

describe("oracle outcome", () => {
  const outcome = (answer: SemanticOracleAnswer) =>
    oracleOutcome(answer, "src/caller.ts", keys);

  it("[happy] keeps every mapped in-repo cross-file target, sorted and unique", () => {
    expect(
      outcome({
        kind: "locations",
        locations: [
          at(decl("src/b.ts", "open", { containerName: "Box", startLine: 11 })),
          at(decl("src/a.ts", "run")),
          at(decl("src/a.ts", "run")),
        ],
      }),
    ).toEqual({
      status: "resolved",
      targetIds: ["src/a.ts#run", "src/b.ts#Box.open@L11"],
      unmappedLocations: 0,
    });
  });

  it("[negative] an empty answer is empty, never a resolved negative", () => {
    expect(outcome({ kind: "locations", locations: [] })).toEqual({
      status: "empty",
      targetIds: [],
      unmappedLocations: 0,
    });
  });

  it("[boundary] only external, same-file or unmappable locations is unsupported", () => {
    expect(
      outcome({
        kind: "locations",
        locations: [
          at(null, "/lib/lib.es5.d.ts", true),
          at(decl("src/caller.ts", "run")),
          at(decl("src/c.ts", "missing")),
          at(null, "src/d.ts"),
        ],
      }),
    ).toEqual({ status: "unsupported", targetIds: [], unmappedLocations: 2 });
  });

  it("[state-diff] a mapped target survives alongside unmapped extras", () => {
    expect(
      outcome({
        kind: "locations",
        locations: [at(decl("src/a.ts", "run")), at(decl("src/c.ts", "x"))],
      }),
    ).toEqual({
      status: "resolved",
      targetIds: ["src/a.ts#run"],
      unmappedLocations: 1,
    });
  });

  it("[error-handling] timeout, not-ready and error stay distinct statuses", () => {
    for (const kind of ["timeout", "not-ready", "error"] as const)
      expect(outcome({ kind, message: "x" })).toEqual({
        status: kind,
        targetIds: [],
        unmappedLocations: 0,
      });
  });
});
