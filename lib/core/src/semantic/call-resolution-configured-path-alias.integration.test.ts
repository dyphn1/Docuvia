import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  ErrorCodes,
  type CallResolutionConfiguredPathAliases,
} from "@workspace/contracts";
import { AstWorkerPool } from "../ast/ast-worker-pool.js";
import { candidateTargetKeyForDeclaration } from "./call-resolution-hypothesis-index.js";
import { hash } from "./call-resolution-hypothesis-internal.js";
import { CallResolutionHypothesisService } from "./call-resolution-hypothesis.service.js";

let pool: AstWorkerPool;
beforeAll(async () => {
  pool = new AstWorkerPool();
  await pool.initialize(1);
});
afterAll(async () => {
  await pool.terminate();
});

function configuration(): CallResolutionConfiguredPathAliases {
  return {
    configurationFilePath: "tsconfig.json",
    sourceContentHash: "c".repeat(64),
    paths: { "@/*": ["./src/*"] },
    baseUrl: null,
    extends: [],
  };
}

async function fixture(
  targetCode = "export function shutdown(): void {}",
  modulePath = "@/implementation",
  callerCode = `import { shutdown as finish } from "${modulePath}"; finish();`,
) {
  const files = [
    { filePath: "src/implementation.ts", code: targetCode },
    { filePath: "src/existing.ts", code: "export function finish(): void {}" },
    { filePath: "src/caller.ts", code: callerCode },
  ];
  const sourceFiles = await Promise.all(
    files.map(async ({ filePath, code }) => {
      const parsed = await pool.parse({
        filePath,
        code,
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
      });
      if (!parsed.success || !parsed.data)
        throw new Error(parsed.error ?? "Missing parser fixture data");
      return {
        filePath,
        sourceContentHash: createHash("sha256").update(code).digest("hex"),
        imports: parsed.data.imports,
        exports: parsed.data.exports,
        callSiteShapeFacts: parsed.data.callSiteShapeFacts,
        declaredTypeFacts: parsed.data.declaredTypeFacts ?? null,
      };
    }),
  );
  const caller = sourceFiles[2]!;
  const callSite = caller.callSiteShapeFacts?.callSites.find(
    ({ calleeName }) => calleeName === "finish",
  );
  if (!callSite) throw new Error("Missing parser fixture call");
  const declaration = sourceFiles[0]!.declaredTypeFacts?.declarations.find(
    ({ name }) => name === "shutdown",
  );
  if (!declaration) throw new Error("Missing parser fixture declaration");
  const targetKey = candidateTargetKeyForDeclaration(
    "src/implementation.ts",
    declaration,
  )!;
  const input = {
    sourceFingerprint: "a".repeat(64),
    sourceIndexComplete: false,
    sourceFiles,
  };
  const request = {
    callerFilePath: caller.filePath,
    callerSourceContentHash: caller.sourceContentHash,
    callSite,
  };
  return { input, request, targetKey };
}

describe("configured named-import candidate evidence", () => {
  it("[invalid-input] abstains when the same export name has multiple descriptors", async () => {
    const { input, request, targetKey } = await fixture();
    const target = input.sourceFiles[0]!;
    const service = new CallResolutionHypothesisService();
    const workspaceIndex = service.indexWorkspace({
      ...input,
      configuredPathAliases: configuration(),
      sourceFiles: [
        {
          ...target,
          exports: [...target.exports, { name: "shutdown", type: "class" }],
        },
        ...input.sourceFiles.slice(1),
      ],
    });
    expect(
      service.hypothesize({ ...request, workspaceIndex })
        .generatedCandidateKeys,
    ).not.toContain(targetKey);
  });
  it("[error-handling] rejects a configuration-bound index handle owned by another service", async () => {
    const { input, request } = await fixture();
    const workspaceIndex = new CallResolutionHypothesisService().indexWorkspace(
      { ...input, configuredPathAliases: configuration() },
    );
    expect(() =>
      new CallResolutionHypothesisService().hypothesize({
        ...request,
        workspaceIndex,
      }),
    ).toThrowError(
      expect.objectContaining({ code: ErrorCodes.SEMANTIC_INVALID_REQUEST }),
    );
  });
  it("[happy] adds only the unique direct function while preserving existing order and abstention", async () => {
    const { input, request, targetKey } = await fixture();
    const service = new CallResolutionHypothesisService();
    const withoutConfig = service.hypothesize({
      ...request,
      workspaceIndex: service.indexWorkspace(input),
    });
    const withConfig = service.hypothesize({
      ...request,
      workspaceIndex: service.indexWorkspace({
        ...input,
        configuredPathAliases: configuration(),
      }),
    });
    expect(request.callSite.calleeBinding?.kind).toBe("import");
    expect(withoutConfig.generatedCandidateKeys).not.toContain(targetKey);
    expect(withConfig.generatedCandidateKeys).toContain(targetKey);
    expect(
      withConfig.generatedCandidateKeys.filter((key) => key !== targetKey),
    ).toEqual(withoutConfig.generatedCandidateKeys);
    expect(withConfig.candidates.map(({ targetKey }) => targetKey)).toContain(
      targetKey,
    );
    expect(withConfig).toMatchObject({
      status: "ambiguous",
      reason: "uncalibrated-signature",
      candidateSetComplete: false,
      strictProof: { status: "abstained" },
      candidateGeneratorVersion: "declared-member-hypothesis-v5",
    });
    expect(withConfig.configurationHash).toBe(withoutConfig.configurationHash);
    expect(withoutConfig.sourceFingerprint).toBe(
      hash({
        manifestFingerprint: input.sourceFingerprint,
        sourceFiles: input.sourceFiles,
      }),
    );
  });

  it("[state-diff] snapshots config and binds config changes into source and feature hashes", async () => {
    const { input, request } = await fixture();
    const service = new CallResolutionHypothesisService();
    const evidence = configuration();
    const workspaceIndex = service.indexWorkspace({
      ...input,
      configuredPathAliases: evidence,
    });
    const before = service.hypothesize({ ...request, workspaceIndex });
    (evidence.paths["@/*"] as string[])[0] = "./other/*";
    const after = service.hypothesize({ ...request, workspaceIndex });
    expect(after).toEqual(before);
    expect(workspaceIndex).not.toHaveProperty("configuredPathAliases");
    const changed = service.hypothesize({
      ...request,
      workspaceIndex: service.indexWorkspace({
        ...input,
        configuredPathAliases: {
          ...configuration(),
          sourceContentHash: "d".repeat(64),
        },
      }),
    });
    expect(changed.generatedCandidateKeys).toEqual(
      before.generatedCandidateKeys,
    );
    expect(changed.sourceFingerprint).not.toBe(before.sourceFingerprint);
    expect(changed.featureInputHash).not.toBe(before.featureInputHash);
  });

  it("[invalid-input] keeps type-only, shadowed, indirect and non-function targets on fallback", async () => {
    const cases = [
      { target: "export const shutdown = () => {};" },
      { target: 'export { shutdown } from "./other"; function shutdown() {}' },
      { target: "function shutdown() {}" },
      {
        caller:
          'import type { shutdown as finish } from "@/implementation"; finish();',
      },
      {
        caller:
          'import { shutdown as finish } from "@/implementation"; function run(finish: () => void) { finish(); }',
      },
      {
        caller:
          'import { shutdown as finish } from "@/implementation"; import { other as finish } from "@/other"; finish();',
      },
    ];
    for (const scenario of cases) {
      const { input, request, targetKey } = await fixture(
        scenario.target,
        "@/implementation",
        scenario.caller,
      );
      const service = new CallResolutionHypothesisService();
      const result = service.hypothesize({
        ...request,
        workspaceIndex: service.indexWorkspace({
          ...input,
          configuredPathAliases: configuration(),
        }),
      });
      expect(result.generatedCandidateKeys).not.toContain(targetKey);
      expect(result.strictProof.status).toBe("abstained");
    }
  });
});
