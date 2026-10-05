import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
  type AstDeclaredDeclaration,
  type AstDeclaredTypeFacts,
} from "../../lib/contracts/src/index.js";
import { candidateTargetKeyForDeclaration } from "../../lib/core/src/semantic/call-resolution-hypothesis-index.js";
import {
  directImportTargetPaths,
  mapCandidateKeysToUnambiguousAliases,
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
