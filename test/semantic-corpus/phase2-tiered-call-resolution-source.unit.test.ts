import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
  type AstDeclaredDeclaration,
  type AstDeclaredTypeFacts,
  type AstImportDescriptor,
  type ParsedAstFileResult,
  type AstReexportDescriptor,
} from "../../lib/contracts/src/index.js";
import {
  candidateTargetKeyForDeclaration,
  candidateTargetKeyForExportedValue,
} from "../../lib/core/src/semantic/call-resolution-hypothesis-index.js";
import {
  directImportTargetPaths,
  mapCandidateKeysToUnambiguousAliases,
  rankingSignalsForTopCandidate,
  reexportTargetPaths,
  reexportTargetsForFrontier,
  validateFactsAgainstSnapshot,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts";
import type { Phase2FactFile } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-support.mjs";
import { git, hashSnapshot } from "../../scripts/semantic-corpus/snapshot.mts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function makeDeclaration(
  name: string,
  start: number,
  end: number,
): AstDeclaredDeclaration {
  return {
    kind: "arrow",
    name,
    declarationSpan: { start, end },
    owner: {
      kind: "program",
      name: null,
      span: { start: 0, end: 100 },
      genericTypeParameterNames: [],
    },
    lexicalScopeSpan: { start: 0, end: 100 },
    visibility: null,
    isStatic: false,
    isAbstract: false,
    isOptional: false,
    arity: { requiredParameterCount: 0, maxParameterCount: 0 },
    genericTypeParameterNames: [],
  };
}

function makeFacts(
  declarations: readonly AstDeclaredDeclaration[],
): AstDeclaredTypeFacts {
  return {
    schemaVersion: AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
    language: "typescript",
    facts: [],
    declarations,
    ownerInventories: [],
  };
}

function makeFactRow(
  filePath: string,
  fileContentSha256: string,
  declarations: readonly AstDeclaredDeclaration[],
): Phase2FactFile {
  return {
    snapshotId: "snapshot-a",
    repoId: "owner/repository",
    revision: "a".repeat(40),
    snapshotHash: "b".repeat(64),
    filePath,
    fileContentSha256,
    declaredTypeFacts: makeFacts(declarations),
  };
}

describe("Phase 2 source candidate identity", () => {
  it("maps exported values missing from the pinned declaration facts", () => {
    const filePath = "packages/common/module.decorator.ts";
    const parsed = new Map<string, ParsedAstFileResult>([
      [
        filePath,
        {
          file: filePath,
          data: {
            exports: [{ name: "Module", type: "variable" }],
          },
        } as ParsedAstFileResult,
      ],
    ]);

    expect(
      mapCandidateKeysToUnambiguousAliases(
        [candidateTargetKeyForExportedValue(filePath, "Module")],
        [makeFactRow(filePath, "c".repeat(64), [])],
        parsed,
      ),
    ).toEqual({
      aliases: [`${filePath}#Module`],
      unmapped: 0,
      ambiguous: 0,
    });
  });

  it("[state-diff] preserves ranking signals from the top ranked proposal", () => {
    expect(
      rankingSignalsForTopCandidate([
        { rankingSignals: ["partial-binding-peer-member-usage"] },
        { rankingSignals: ["same-directory"] },
      ]),
    ).toEqual(["partial-binding-peer-member-usage"]);
    expect(rankingSignalsForTopCandidate([])).toEqual([]);
  });

  it("[happy] includes unaliased direct named-import targets for opt-in Q1 audits", () => {
    const callFiles = [
      {
        file: "src/caller.ts",
        data: {
          imports: [
            {
              localName: "run",
              originalName: "run",
              modulePath: "./implementation.js",
            },
          ],
        },
      },
    ];
    const facts = [makeFactRow("src/implementation.ts", "c".repeat(64), [])];

    expect(directImportTargetPaths(callFiles, facts)).toEqual([]);
    expect(
      directImportTargetPaths(callFiles, facts, undefined, {
        includeUnaliasedNamedImports: true,
      }),
    ).toEqual(["src/implementation.ts"]);
  });

  it("[happy] resolves a combined default import with a source-bound workspace alias", () => {
    const callFiles = [
      {
        file: "src/app/report/page.test.tsx",
        data: {
          imports: [
            {
              localName: "ReportPage",
              originalName: "default",
              modulePath: "@/app/report/page",
              isCombinedDefaultImport: true,
            },
          ],
        },
      },
    ];
    const facts = [makeFactRow("src/app/report/page.tsx", "c".repeat(64), [])];
    const configuredPathAliases = {
      configurationFilePath: "tsconfig.json",
      sourceContentHash: "d".repeat(64),
      paths: { "@/*": ["./src/*"] },
      baseUrl: null,
      extends: [],
    } as const;

    expect(
      directImportTargetPaths(callFiles, facts, configuredPathAliases),
    ).toEqual([]);
    expect(
      directImportTargetPaths(callFiles, facts, configuredPathAliases, {
        includeCombinedDefaultImports: true,
      }),
    ).toEqual(["src/app/report/page.tsx"]);
  });

  it("[happy][state-diff] includes type-only imports only for Q3 receiver audits", () => {
    const callFiles = [
      {
        file: "src/caller.ts",
        data: {
          imports: [
            {
              localName: "Service",
              originalName: "Service",
              modulePath: "./service.js",
              isTypeOnly: true,
            },
          ],
        },
      },
    ];
    const facts = [makeFactRow("src/service.ts", "c".repeat(64), [])];

    expect(
      directImportTargetPaths(callFiles, facts, undefined, {
        includeUnaliasedNamedImports: true,
      }),
    ).toEqual([]);
    expect(
      directImportTargetPaths(callFiles, facts, undefined, {
        includeUnaliasedNamedImports: true,
        includeTypeOnlyImports: true,
      }),
    ).toEqual(["src/service.ts"]);
  });

  it("[happy][state-diff] maps a unique named arrow candidate to its corpus target ID", () => {
    const declaration = makeDeclaration("run", 11, 40);
    const key = candidateTargetKeyForDeclaration("src/worker.ts", declaration);
    expect(key).toBe("src/worker.ts#function:11:40#run");
    if (!key) throw new Error("named program arrow did not produce a key");

    const mapping = mapCandidateKeysToUnambiguousAliases(
      [key],
      [makeFactRow("src/worker.ts", "c".repeat(64), [declaration])],
    );

    expect(mapping).toEqual({
      aliases: ["src/worker.ts#run"],
      unmapped: 0,
      ambiguous: 0,
    });
  });

  it("[error-handling][stress] does not merge same-file duplicate names into one oracle ID", () => {
    const declarations = [
      makeDeclaration("run", 11, 40),
      makeDeclaration("run", 51, 80),
    ];
    const keys = declarations.map((declaration) =>
      candidateTargetKeyForDeclaration("src/worker.ts", declaration),
    );
    expect(keys).toEqual([
      "src/worker.ts#function:11:40#run",
      "src/worker.ts#function:51:80#run",
    ]);
    const candidateKeys = keys.filter(
      (key): key is string => key !== undefined,
    );
    expect(new Set(candidateKeys).size).toBe(2);

    const mapping = mapCandidateKeysToUnambiguousAliases(candidateKeys, [
      makeFactRow("src/worker.ts", "c".repeat(64), declarations),
    ]);

    expect(mapping).toEqual({ aliases: [], unmapped: 0, ambiguous: 2 });
  });

  it("[invalid-input] refuses facts whose source hash differs from the pinned snapshot", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "docuvia-phase2-facts-"));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "src/worker.ts"),
      "export const run = () => 1;\n",
    );
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "--no-verify", "-m", "test snapshot"]);
    const snapshotHash = hashSnapshot(root).hash;

    expect(() =>
      validateFactsAgainstSnapshot(root, snapshotHash, [
        makeFactRow("src/worker.ts", "0".repeat(64), [
          makeDeclaration("run", 0, 20),
        ]),
      ]),
    ).toThrow("Phase 1 facts are stale for src/worker.ts.");
  });
});

describe("phase 2 re-export source discovery", () => {
  it("[happy] follows named, star, and unambiguous local re-exports only", () => {
    const factRows = [
      "src/barrel.ts",
      "src/impl.ts",
      "src/more.ts",
      "src/local.ts",
      "src/ns.ts",
      "src/types.ts",
    ].map((filePath) => ({ filePath })) as unknown as Phase2FactFile[];
    const imports: AstImportDescriptor[] = [
      {
        localName: "localBinding",
        originalName: "work",
        modulePath: "./local.js",
      },
    ];
    const reexports: AstReexportDescriptor[] = [
      {
        kind: "named",
        exportedName: "publicWork",
        importedName: "work",
        modulePath: "./impl.js",
      },
      {
        kind: "star",
        exportedName: "*",
        modulePath: "./more.js",
      },
      {
        kind: "local",
        exportedName: "renamedLocal",
        localName: "localBinding",
      },
      {
        kind: "namespace",
        exportedName: "namespaceTools",
        modulePath: "./ns.js",
      },
      {
        kind: "named",
        exportedName: "TypeOnly",
        importedName: "TypeOnly",
        modulePath: "./types.js",
        isTypeOnly: true,
      },
    ];

    expect(
      reexportTargetPaths(
        [{ file: "src/barrel.ts", data: { imports, reexports } }],
        factRows,
      ),
    ).toEqual(["src/impl.ts", "src/local.ts", "src/more.ts"]);
  });

  it("[invalid-input][error-handling] abstains when module resolution has two extension candidates", () => {
    const factRows = ["src/barrel.ts", "src/impl.ts", "src/impl.tsx"].map(
      (filePath) => ({ filePath }),
    ) as unknown as Phase2FactFile[];
    const reexports: AstReexportDescriptor[] = [
      {
        kind: "named",
        exportedName: "work",
        importedName: "work",
        modulePath: "./impl.js",
      },
    ];

    expect(
      reexportTargetPaths(
        [{ file: "src/barrel.ts", data: { reexports } }],
        factRows,
      ),
    ).toEqual([]);
  });

  it("[happy][state-diff] expands a cached call-source intermediate into its downstream barrel", () => {
    const factRows = ["src/intermediate.ts", "src/leaf.ts"].map((filePath) => ({
      filePath,
    })) as unknown as Phase2FactFile[];
    const parsedByPath = new Map([
      [
        "src/intermediate.ts",
        {
          file: "src/intermediate.ts",
          data: {
            reexports: [
              {
                kind: "named",
                exportedName: "publicWork",
                importedName: "work",
                modulePath: "./leaf.js",
              } satisfies AstReexportDescriptor,
            ],
          },
        },
      ],
    ]);
    const expanded = new Set<string>();

    expect(
      reexportTargetsForFrontier(
        ["src/intermediate.ts"],
        parsedByPath,
        expanded,
        factRows,
      ),
    ).toEqual(["src/leaf.ts"]);
    expect([...expanded]).toEqual(["src/intermediate.ts"]);
  });
});
