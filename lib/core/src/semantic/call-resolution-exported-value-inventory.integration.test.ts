import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  type CallResolutionConfiguredPathAliases,
} from "@workspace/contracts";
import { AstWorkerPool } from "../ast/ast-worker-pool.js";
import type { AstParseResponse } from "../ast/ast-worker.js";
import { CallResolutionHypothesisService } from "./call-resolution-hypothesis.service.js";

let pool: AstWorkerPool;

beforeAll(async () => {
  pool = new AstWorkerPool();
  await pool.initialize(1);
});

afterAll(async () => {
  await pool.terminate();
});

function parseData(response: AstParseResponse) {
  if (!response.success || !response.data)
    throw new Error(response.error ?? "AST worker returned no parse data");
  return response.data;
}

const fixtureFiles = [
  {
    filePath: "src/caller.ts",
    code: `import { namedTarget as relativeCall } from "./target";
import { aliasTarget } from "@/alias-target";
import { absentTarget as missingAliasCall } from "@/not-present";
import DefaultTarget from "./default-target";
relativeCall();
aliasTarget();
missingAliasCall();
DefaultTarget();`,
  },
  {
    filePath: "src/target.ts",
    code: "export function namedTarget(): void {}",
  },
  {
    filePath: "src/alias-target.ts",
    code: "export function aliasTarget(): void {}",
  },
  {
    filePath: "src/default-target.ts",
    code: "export default function DefaultTarget(): void {}",
  },
  {
    filePath: "src/constants.ts",
    code: `export const SpecFormat = { JSON: "json" } as const;
export const RELEASE_LABEL = "stable";
export namespace NestedValues {
  const privateNamespaceValue = "not exported";
  export const namespaceValue = "candidate only";
}`,
  },
] as const;

const configuredPathAliases: CallResolutionConfiguredPathAliases = {
  configurationFilePath: "tsconfig.json",
  sourceContentHash: "c".repeat(64),
  paths: { "@/*": ["./src/*"] },
  baseUrl: null,
  extends: [],
};

async function createFixture(
  options: {
    omitSourceFacts?: string;
    includeNonCallableExports?: boolean;
    extraNonCallableExports?: number;
  } = {},
) {
  const extraNonCallableExports = options.extraNonCallableExports ?? 0;
  const definitions = fixtureFiles
    .filter(
      ({ filePath }) =>
        options.includeNonCallableExports !== false ||
        filePath !== "src/constants.ts",
    )
    .map(({ filePath, code }) => ({
      filePath,
      code:
        filePath === "src/constants.ts" && extraNonCallableExports > 0
          ? `${code}\n${Array.from(
              { length: extraNonCallableExports },
              (_, index) => `export const EXTRA_VALUE_${index} = ${index};`,
            ).join("\n")}`
          : code,
    }));
  const sourceFiles = await Promise.all(
    definitions.map(async ({ filePath, code }) => {
      const parsed = parseData(
        await pool.parse({
          filePath,
          language: SUPPORTED_LANGUAGES.TYPESCRIPT,
          code,
        }),
      );
      return {
        filePath,
        sourceContentHash: createHash("sha256").update(code).digest("hex"),
        imports: parsed.imports,
        exports: parsed.exports,
        reexports: parsed.reexports,
        callSiteShapeFacts: parsed.callSiteShapeFacts,
        declaredTypeFacts:
          filePath === options.omitSourceFacts
            ? null
            : (parsed.declaredTypeFacts ?? null),
      };
    }),
  );
  const service = new CallResolutionHypothesisService();
  const workspaceIndex = service.indexWorkspace({
    sourceFingerprint: "a".repeat(64),
    sourceIndexComplete: true,
    sourceFiles,
    configuredPathAliases,
  });
  const caller = sourceFiles.find(
    ({ filePath }) => filePath === "src/caller.ts",
  );
  if (!caller?.callSiteShapeFacts || !caller.sourceContentHash)
    throw new Error("Missing caller source facts");
  const resultFor = (calleeName: string) => {
    const matches = caller.callSiteShapeFacts!.callSites.filter(
      (callSite) => callSite.calleeName === calleeName,
    );
    if (matches.length !== 1)
      throw new Error(`Missing unique call to ${calleeName}`);
    return service.hypothesize({
      callerFilePath: caller.filePath,
      callerSourceContentHash: caller.sourceContentHash,
      callSite: matches[0]!,
      workspaceIndex,
    });
  };
  return { resultFor, sourceFiles };
}

describe("exported non-callable values and strict proof inventory", () => {
  it("[happy] preserves complete Q1 proofs beside candidate-only exported values", async () => {
    const { resultFor } = await createFixture();
    const result = resultFor("relativeCall");

    expect(result.strictProof).toMatchObject({
      status: "proven",
      ruleSignature: "q1:named-import:v1",
      reason: "unique-named-import",
    });
    expect(result.candidateSetComplete).toBe(true);
  });

  it("[invalid-input] leaves unresolved @/ imports unproven without poisoning Q1", async () => {
    const { resultFor } = await createFixture();
    const relative = resultFor("relativeCall");
    const missingAlias = resultFor("missingAliasCall");

    expect(relative.strictProof.status).toBe("proven");
    expect(missingAlias.strictProof.status).toBe("abstained");
    expect(missingAlias.candidateSetComplete).toBe(true);
  });

  it("[error-handling] keeps genuine missing declaration facts fail-closed", async () => {
    const { resultFor } = await createFixture({
      omitSourceFacts: "src/constants.ts",
    });

    expect(resultFor("relativeCall").strictProof).toMatchObject({
      status: "abstained",
      reason: "incomplete-inventory",
    });
  });

  it("[stress] keeps Q1 complete with a large non-callable export inventory", async () => {
    const { resultFor } = await createFixture({ extraNonCallableExports: 128 });
    const result = resultFor("relativeCall");

    expect(result.strictProof.status).toBe("proven");
    expect(result.candidateSetComplete).toBe(true);
  });

  it("[state-diff] keeps default and missing-alias calls outside the Q1 proof scope", async () => {
    const withCandidateValues = await createFixture();
    const withoutCandidateValues = await createFixture({
      includeNonCallableExports: false,
    });

    expect(withCandidateValues.resultFor("relativeCall").strictProof).toEqual(
      withoutCandidateValues.resultFor("relativeCall").strictProof,
    );
    expect(
      withCandidateValues.resultFor("aliasTarget").strictProof.status,
    ).toBe("proven");
    expect(
      withCandidateValues.resultFor("missingAliasCall").strictProof.status,
    ).toBe("abstained");
    expect(
      withCandidateValues.resultFor("DefaultTarget").strictProof.status,
    ).toBe("abstained");
  });
});
