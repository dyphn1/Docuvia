import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  type CallResolutionConfiguredPathAliases,
} from "@workspace/contracts";
import { AstWorkerPool } from "../ast/ast-worker-pool.js";
import { candidateTargetKeyForDeclaration } from "./call-resolution-hypothesis-index.js";
import { CallResolutionHypothesisService } from "./call-resolution-hypothesis.service.js";

let pool: AstWorkerPool;

beforeAll(async () => {
  pool = new AstWorkerPool();
  await pool.initialize(1);
});

afterAll(async () => {
  await pool.terminate();
});

function configuration(
  overrides: Partial<CallResolutionConfiguredPathAliases> = {},
): CallResolutionConfiguredPathAliases {
  return {
    configurationFilePath: "tsconfig.json",
    sourceContentHash: "c".repeat(64),
    paths: { "@/*": ["./src/*"] },
    baseUrl: null,
    extends: [],
    ...overrides,
  };
}

function sourceHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

async function analyze(input: {
  readonly callerPath?: string;
  readonly callerCode: string;
  readonly targetPath?: string;
  readonly targetCode: string;
  readonly extraFiles?: readonly { filePath: string; code: string }[];
  readonly configuredPathAliases?: CallResolutionConfiguredPathAliases;
}) {
  const callerPath = input.callerPath ?? "src/caller.ts";
  const targetPath = input.targetPath ?? "src/implementation.ts";
  const files = [
    { filePath: targetPath, code: input.targetCode },
    ...(input.extraFiles ?? []),
    { filePath: callerPath, code: input.callerCode },
  ];
  const parsedFiles = await Promise.all(
    files.map(async ({ filePath, code }) => {
      const response = await pool.parse({
        filePath,
        code,
        language: SUPPORTED_LANGUAGES.TYPESCRIPT,
      });
      if (!response.success || !response.data)
        throw new Error(response.error ?? `AST parse failed for ${filePath}`);
      return {
        filePath,
        code,
        data: response.data,
      };
    }),
  );
  const caller = parsedFiles.find(({ filePath }) => filePath === callerPath);
  const callSite = caller?.data.callSiteShapeFacts?.callSites.find(
    ({ calleeName }) => calleeName === "ReportPage",
  );
  if (!caller || !callSite)
    throw new Error(`The AST worker omitted ReportPage in ${callerPath}`);

  const service = new CallResolutionHypothesisService();
  const workspaceIndex = service.indexWorkspace({
    sourceFingerprint: "a".repeat(64),
    sourceIndexComplete: false,
    sourceFiles: parsedFiles.map(({ filePath, code, data }) => ({
      filePath,
      sourceContentHash: sourceHash(code),
      imports: data.imports,
      exports: data.exports,
      callSiteShapeFacts: data.callSiteShapeFacts,
      declaredTypeFacts: data.declaredTypeFacts ?? null,
    })),
    ...(input.configuredPathAliases === undefined
      ? {}
      : { configuredPathAliases: input.configuredPathAliases }),
  });
  const result = service.hypothesize({
    callerFilePath: callerPath,
    callerSourceContentHash: sourceHash(caller.code),
    callSite,
    workspaceIndex,
  });
  const targetDeclarations = parsedFiles
    .filter(({ filePath }) => filePath === targetPath)
    .flatMap(({ data }) => data.declaredTypeFacts?.declarations ?? []);
  const namedTargetKeys = targetDeclarations.flatMap((declaration) => {
    const key = candidateTargetKeyForDeclaration(targetPath, declaration);
    return key ? [key] : [];
  });
  return {
    result,
    callSite,
    imports: caller.data.imports,
    exports: parsedFiles.find(({ filePath }) => filePath === targetPath)?.data
      .exports,
    targetPath,
    namedTargetKeys,
  };
}

describe("combined default-import candidates", () => {
  it("[happy] [state-diff] adds the unique named direct default function from an explicit workspace path mapping", async () => {
    const { result, callSite, imports, namedTargetKeys } = await analyze({
      callerCode:
        'import ReportPage, { generateMetadata } from "@/implementation"; ReportPage();',
      targetCode: "export default async function PrivateReportPage() {}",
      configuredPathAliases: configuration(),
    });
    const defaultImport = imports.find(
      ({ localName }) => localName === "ReportPage",
    );
    const goldTarget = namedTargetKeys.find((key) =>
      key.endsWith("#PrivateReportPage"),
    );
    const baseline = await analyze({
      callerCode:
        'import ReportPage, { generateMetadata } from "@/implementation"; ReportPage();',
      targetCode: "export default async function PrivateReportPage() {}",
    });

    expect(defaultImport).toMatchObject({
      originalName: "default",
      isCombinedDefaultImport: true,
      modulePath: "@/implementation",
    });
    expect(callSite.calleeBinding?.kind).toBe("import");
    expect(baseline.result.generatedCandidateKeys).not.toContain(goldTarget);
    expect(result.generatedCandidateKeys).toContain(goldTarget);
    expect(result).toMatchObject({
      status: "ambiguous",
      reason: "uncalibrated-signature",
      candidateSetComplete: false,
      strictProof: { status: "abstained" },
    });
    expect(result.selected).toBeNull();
  });

  it("[happy] maps an anonymous direct default function to one stable default candidate", async () => {
    const { result, exports } = await analyze({
      callerCode:
        'import ReportPage, { metadata } from "./implementation"; ReportPage();',
      targetCode: "export default function () {}",
    });

    expect(exports).toEqual([
      expect.objectContaining({ name: "default", type: "function" }),
    ]);
    expect(
      result.generatedCandidateKeys.filter((key) =>
        key.startsWith("src/implementation.ts#function:"),
      ),
    ).toHaveLength(1);
    expect(result.generatedCandidateKeys[0]).toMatch(/#default$/u);
    expect(result.strictProof.status).toBe("abstained");
  });

  it("[invalid-input] [error-handling] [stress] abstains on unsupported default sources without selecting a target", async () => {
    const defaultCaller =
      'import ReportPage, { metadata } from "@/implementation"; ReportPage();';
    const scenarios = [
      {
        name: "default object expression",
        targetCode: "export default { render() {} };",
      },
      {
        name: "default arrow expression",
        targetCode: "export default () => {};",
      },
      {
        name: "default class",
        targetCode: "export default class PrivateReportPage {}",
      },
      {
        name: "multiple default functions",
        targetCode:
          "export default function FirstPage() {} export default function SecondPage() {}",
      },
      {
        name: "default local binding alias",
        targetCode:
          "function PrivateReportPage() {} export default PrivateReportPage;",
      },
      {
        name: "re-exported default",
        targetCode: 'export { default } from "./actual";',
      },
      {
        name: "export-equals",
        targetCode: "export = function PrivateReportPage() {};",
      },
      {
        name: "CommonJS export",
        targetCode: "module.exports = function PrivateReportPage() {};",
      },
      {
        name: "dynamic import",
        callerCode:
          'const ReportPage = await import("@/implementation"); ReportPage();',
        targetCode: "export default function PrivateReportPage() {}",
      },
      {
        name: "require call",
        callerCode:
          'const ReportPage = require("@/implementation"); ReportPage();',
        targetCode: "export default function PrivateReportPage() {}",
      },
      {
        name: "named import of default export",
        callerCode:
          'import { default as ReportPage, metadata } from "@/implementation"; ReportPage();',
        targetCode: "export default function PrivateReportPage() {}",
      },
      {
        name: "type-only combined import",
        callerCode:
          'import type ReportPage, { Metadata } from "@/implementation"; ReportPage();',
        targetCode: "export default function PrivateReportPage() {}",
      },
    ];
    for (const scenario of scenarios) {
      const { result, targetPath } = await analyze({
        callerCode: scenario.callerCode ?? defaultCaller,
        targetCode: scenario.targetCode,
        configuredPathAliases: configuration(),
      });
      expect(
        result.generatedCandidateKeys.filter((key) =>
          key.startsWith(`${targetPath}#`),
        ),
        scenario.name,
      ).toEqual([]);
      expect(result.strictProof.status, scenario.name).toBe("abstained");
    }
  });

  it("[boundary] keeps ambiguous paths, inherited mappings, and workspace escapes on fallback", async () => {
    const code = "export default function PrivateReportPage() {}";
    const ambiguous = await analyze({
      callerCode:
        'import ReportPage, { metadata } from "@/implementation"; ReportPage();',
      targetCode: code,
      extraFiles: [{ filePath: "src/implementation.tsx", code }],
      configuredPathAliases: configuration(),
    });
    const inherited = await analyze({
      callerCode:
        'import ReportPage, { metadata } from "@/implementation"; ReportPage();',
      targetCode: code,
      configuredPathAliases: configuration({ extends: ["./base.json"] }),
    });
    const outside = await analyze({
      callerPath: "src/nested/caller.ts",
      callerCode:
        'import ReportPage, { metadata } from "../../../outside/implementation"; ReportPage();',
      targetPath: "../outside/implementation.ts",
      targetCode: code,
    });

    expect(ambiguous.result.generatedCandidateKeys).toEqual([]);
    expect(inherited.result.generatedCandidateKeys).toEqual([]);
    expect(outside.result.generatedCandidateKeys).toEqual([]);
    expect(ambiguous.result.strictProof.status).toBe("abstained");
    expect(inherited.result.strictProof.status).toBe("abstained");
    expect(outside.result.strictProof.status).toBe("abstained");
  });
});
