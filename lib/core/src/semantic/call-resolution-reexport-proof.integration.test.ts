import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
  SUPPORTED_LANGUAGES,
  type CallResolutionConfiguredPathAliases,
} from "@workspace/contracts";
import { AstWorkerPool } from "../ast/ast-worker-pool.js";
import type { AstParseResponse } from "../ast/ast-worker.js";
import { CallResolutionHypothesisService } from "./call-resolution-hypothesis.service.js";

interface SourceInput {
  readonly filePath: string;
  readonly code: string;
}

interface ProofOptions {
  readonly maxCandidates?: number;
  readonly incompleteReexportInventoryFile?: string;
  readonly configuredPathAliases?: CallResolutionConfiguredPathAliases;
}

type ParsedSourceInput = SourceInput & {
  readonly data: ReturnType<typeof parseData>;
};

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

async function parseFile(filePath: string, code: string) {
  return parseData(
    await pool.parse({
      filePath,
      language: SUPPORTED_LANGUAGES.TYPESCRIPT,
      code,
    }),
  );
}

function sha256(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function callerFrom(
  modulePath: string,
  importedName = "work",
  localName = "run",
  filePath = "src/caller.ts",
): SourceInput {
  return {
    filePath,
    code: [
      "import { " +
        importedName +
        " as " +
        localName +
        ' } from "' +
        modulePath +
        '";',
      "export function caller(): void { " + localName + "(); }",
    ].join("\n"),
  };
}

function barrelChain(edgeCount: number): SourceInput[] {
  return [
    ...Array.from({ length: edgeCount }, (_, index) => ({
      filePath: "src/barrel-" + index + ".ts",
      code:
        index + 1 === edgeCount
          ? 'export { work } from "./impl.js";'
          : 'export { work } from "./barrel-' + (index + 1) + '.js";',
    })),
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
  ];
}

function findNamedImportCallSite(parsedFiles: readonly ParsedSourceInput[]) {
  const caller = parsedFiles.find(({ filePath }) =>
    filePath.endsWith("/caller.ts"),
  );
  const callSites = caller?.data.callSiteShapeFacts?.callSites ?? [];
  const localName = callSites[0]?.calleeName;
  const callSite = callSites.find((call) => call.calleeName === localName);
  return caller && callSite ? { caller, callSite } : null;
}

async function hypothesize(
  files: readonly SourceInput[],
  options: ProofOptions = {},
) {
  const parsedFiles = await Promise.all(
    files.map(async (file) => ({
      ...file,
      data: await parseFile(file.filePath, file.code),
    })),
  );
  const callerWithCall = findNamedImportCallSite(parsedFiles);
  if (!callerWithCall)
    throw new Error("AST worker omitted the named-import call site");
  const { caller, callSite } = callerWithCall;

  const service = new CallResolutionHypothesisService(
    options.maxCandidates === undefined
      ? {}
      : { maxCandidates: options.maxCandidates },
  );
  const workspaceIndex = service.indexWorkspace({
    sourceFingerprint: "f".repeat(64),
    sourceIndexComplete: true,
    sourceFiles: parsedFiles.map(({ filePath, code, data }) => ({
      filePath,
      sourceContentHash: sha256(code),
      imports: data.imports,
      exports: data.exports,
      reexports:
        filePath === options.incompleteReexportInventoryFile
          ? undefined
          : data.reexports,
      callSiteShapeFacts: data.callSiteShapeFacts,
      declaredTypeFacts: data.declaredTypeFacts ?? null,
    })),
    ...(options.configuredPathAliases === undefined
      ? {}
      : { configuredPathAliases: options.configuredPathAliases }),
  });
  return service.hypothesize({
    callerFilePath: caller.filePath,
    callerSourceContentHash: sha256(caller.code),
    callSite,
    workspaceIndex,
  });
}

const q2Signature = CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE;

describe("call-resolution strict Q2 re-export proof", () => {
  it("proves one named re-export hop, preserves the imported symbol, and fingerprints the chain", async () => {
    const implementation = {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    };
    const barrel = {
      filePath: "src/barrel.ts",
      code: 'export { work as publicWork } from "./impl.js";',
    };
    const caller = callerFrom("./barrel.js", "publicWork");
    const result = await hypothesize([implementation, barrel, caller]);

    expect(result.strictProof).toMatchObject({
      status: "proven",
      targetKey: "src/impl.ts#function:7:31#work",
      ruleSignature: q2Signature,
      reason: "unique-named-import",
      targetFilePath: "src/impl.ts",
      targetName: "work",
      dependencies: [
        { filePath: "src/barrel.ts", contentHash: sha256(barrel.code) },
        { filePath: "src/caller.ts", contentHash: sha256(caller.code) },
        {
          filePath: "src/impl.ts",
          contentHash: sha256(implementation.code),
        },
      ],
    });
    expect(result.selected).toBeNull();
  });

  it("proves multi-hop renamed exports by tracing each file-symbol pair", async () => {
    const implementation = {
      filePath: "src/impl.ts",
      code: "export function canonical(): void {}",
    };
    const firstBarrel = {
      filePath: "src/first.ts",
      code: 'export { canonical as middleName } from "./impl.js";',
    };
    const secondBarrel = {
      filePath: "src/second.ts",
      code: 'export { middleName as publicName } from "./first.js";',
    };
    const caller = callerFrom("./second.js", "publicName");
    const result = await hypothesize([
      implementation,
      firstBarrel,
      secondBarrel,
      caller,
    ]);

    expect(result.strictProof).toMatchObject({
      status: "proven",
      targetKey: "src/impl.ts#function:7:36#canonical",
      ruleSignature: q2Signature,
      targetFilePath: "src/impl.ts",
      targetName: "canonical",
      dependencies: [
        { filePath: "src/caller.ts", contentHash: sha256(caller.code) },
        {
          filePath: "src/first.ts",
          contentHash: sha256(firstBarrel.code),
        },
        {
          filePath: "src/impl.ts",
          contentHash: sha256(implementation.code),
        },
        {
          filePath: "src/second.ts",
          contentHash: sha256(secondBarrel.code),
        },
      ],
    });
  });

  it("proves one unambiguous export-star path", async () => {
    const implementation = {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    };
    const barrel = {
      filePath: "src/barrel.ts",
      code: 'export * from "./impl.js";',
    };
    const caller = callerFrom("./barrel.js");
    const result = await hypothesize([implementation, barrel, caller]);

    expect(result.strictProof).toMatchObject({
      status: "proven",
      targetKey: "src/impl.ts#function:7:31#work",
      ruleSignature: q2Signature,
      targetFilePath: "src/impl.ts",
      targetName: "work",
    });
  });

  it("does not resolve a default import through an export-star barrel", async () => {
    const implementation = {
      filePath: "src/impl.ts",
      code: "export default function worker(): void {}",
    };
    const barrel = {
      filePath: "src/barrel.ts",
      code: 'export * from "./impl.js";',
    };
    const caller = callerFrom("./barrel.js", "default");
    const result = await hypothesize([implementation, barrel, caller]);

    expect(result.strictProof?.status).toBe("abstained");
    expect(result.strictProof?.reason).toBe("unresolved-call-binding");
  });

  it("proves a local re-export of one imported binding", async () => {
    const implementation = {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    };
    const barrel = {
      filePath: "src/barrel.ts",
      code: [
        'import { work as importedWork } from "./impl.js";',
        "export { importedWork as publicWork };",
      ].join("\n"),
    };
    const caller = callerFrom("./barrel.js", "publicWork");
    const result = await hypothesize([implementation, barrel, caller]);

    expect(result.strictProof).toMatchObject({
      status: "proven",
      targetKey: "src/impl.ts#function:7:31#work",
      ruleSignature: q2Signature,
      targetFilePath: "src/impl.ts",
      targetName: "work",
    });
  });

  it("proves a trivially unique named re-export of a default function", async () => {
    const implementation = {
      filePath: "src/impl.ts",
      code: "export default function worker(): void {}",
    };
    const barrel = {
      filePath: "src/barrel.ts",
      code: 'export { default as publicWork } from "./impl.js";',
    };
    const caller = callerFrom("./barrel.js", "publicWork");
    const result = await hypothesize([implementation, barrel, caller]);

    expect(result.strictProof).toMatchObject({
      status: "proven",
      targetKey: "src/impl.ts#function:15:41#worker",
      ruleSignature: q2Signature,
      targetFilePath: "src/impl.ts",
      targetName: "worker",
    });
  });

  it("includes the path configuration in a proof that uses configured aliases", async () => {
    const implementation = {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    };
    const barrel = {
      filePath: "src/barrel.ts",
      code: 'export { work } from "@/impl.js";',
    };
    const configuredPathAliases: CallResolutionConfiguredPathAliases = {
      configurationFilePath: "tsconfig.json",
      sourceContentHash: sha256("root tsconfig"),
      paths: { "@/*": ["./src/*"] },
      baseUrl: null,
      extends: [],
    };
    const caller = callerFrom("@/barrel.js");
    const result = await hypothesize([implementation, barrel, caller], {
      configuredPathAliases,
    });

    expect(result.strictProof).toMatchObject({
      status: "proven",
      ruleSignature: q2Signature,
      dependencies: [
        { filePath: "src/barrel.ts", contentHash: sha256(barrel.code) },
        { filePath: "src/caller.ts", contentHash: sha256(caller.code) },
        { filePath: "src/impl.ts", contentHash: sha256(implementation.code) },
        { filePath: "tsconfig.json", contentHash: sha256("root tsconfig") },
      ],
    });
  });

  it("accepts exactly sixteen re-export hops", async () => {
    const files = barrelChain(16);
    const caller = callerFrom("./barrel-0.js");
    const result = await hypothesize([...files, caller]);

    expect(result.strictProof).toMatchObject({
      status: "proven",
      targetKey: "src/impl.ts#function:7:31#work",
      ruleSignature: q2Signature,
    });
  });

  const cycleFiles = [
    {
      filePath: "src/first.ts",
      code: 'export { work } from "./second.js";',
    },
    {
      filePath: "src/second.ts",
      code: 'export { work } from "./first.js";',
    },
    callerFrom("./first.js"),
  ];
  const depth17Files = [...barrelChain(17), callerFrom("./barrel-0.js")];
  const deadEndFiles = [
    {
      filePath: "src/barrel.ts",
      code: 'export { work } from "./missing.js";',
    },
    callerFrom("./barrel.js"),
  ];
  const multipleStarFiles = [
    {
      filePath: "src/first.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/second.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: [
        'export * from "./first.js";',
        'export * from "./second.js";',
      ].join("\n"),
    },
    callerFrom("./barrel.js"),
  ];
  const conflictingStarFiles = [
    {
      filePath: "src/first.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/second.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: [
        "export function work(): void {}",
        'export * from "./first.js";',
        'export * from "./second.js";',
      ].join("\n"),
    },
    callerFrom("./barrel.js"),
  ];
  const ambiguousDefaultFiles = [
    {
      filePath: "src/first.ts",
      code: "export default function first(): void {}",
    },
    {
      filePath: "src/second.ts",
      code: "export default function second(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: [
        'export { default as work } from "./first.js";',
        'export { default as work } from "./second.js";',
      ].join("\n"),
    },
    callerFrom("./barrel.js"),
  ];
  const ambiguousLocalBindingFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/other.ts",
      code: "export function other(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: [
        'import { work as importedWork } from "./impl.js";',
        'import { other as importedWork } from "./other.js";',
        "export { importedWork as publicWork };",
      ].join("\n"),
    },
    callerFrom("./barrel.js", "publicWork"),
  ];
  const namespaceFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: 'export * as work from "./impl.js";',
    },
    callerFrom("./barrel.js"),
  ];
  const typeOnlyFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: 'export type { work } from "./impl.js";',
    },
    callerFrom("./barrel.js"),
  ];
  const escapingFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    callerFrom("../../../outside.js", "work", "run", "src/nested/caller.ts"),
  ];
  const unsupportedSpecifierFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    callerFrom("external-package"),
  ];
  const ambiguousPathFiles = [
    {
      filePath: "src/implementation.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/implementation.tsx",
      code: "export function work(): void {}",
    },
    callerFrom("./implementation.js"),
  ];
  const incompleteChainFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: 'export { work } from "./impl.js";',
    },
    callerFrom("./barrel.js"),
  ];
  const incompleteTargetFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: 'export { work } from "./impl.js";',
    },
    callerFrom("./barrel.js"),
  ];
  const truncatedFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/barrel.ts",
      code: 'export { work } from "./impl.js";',
    },
    {
      filePath: "src/first-run.ts",
      code: "export function run(): void {}",
    },
    {
      filePath: "src/second-run.ts",
      code: "export function run(): void {}",
    },
    callerFrom("./barrel.js"),
  ];
  const collisionFiles = [
    {
      filePath: "src/impl.ts",
      code: "export function work(): void {}",
    },
    {
      filePath: "src/other.ts",
      code: "export const work = (): void => {};",
    },
    {
      filePath: "src/barrel.ts",
      code: 'export { work } from "./impl.js";',
    },
    callerFrom("./barrel.js"),
  ];

  it.each([
    {
      name: "abstains on a cycle in a file-symbol chain",
      files: cycleFiles,
      reason: "unresolved-call-binding",
      options: {},
    },
    {
      name: "abstains when the chain exceeds sixteen hops",
      files: depth17Files,
      reason: "unresolved-call-binding",
      options: {},
    },
    {
      name: "does not fall back to a barrel when a re-export dead-ends",
      files: deadEndFiles,
      reason: "unsupported-call-shape",
      options: {},
    },
    {
      name: "abstains when two export-star sources provide the imported name",
      files: multipleStarFiles,
      reason: "no-unique-owner-candidate",
      options: {},
    },
    {
      name: "abstains when a direct declaration conflicts with ambiguous stars",
      files: conflictingStarFiles,
      reason: "no-unique-owner-candidate",
      options: {},
    },
    {
      name: "abstains when a default re-export is not unique",
      files: ambiguousDefaultFiles,
      reason: "no-unique-owner-candidate",
      options: {},
    },
    {
      name: "abstains when a local re-export binding is ambiguous",
      files: ambiguousLocalBindingFiles,
      reason: "no-unique-owner-candidate",
      options: {},
    },
    {
      name: "abstains on namespace re-exports",
      files: namespaceFiles,
      reason: "unsupported-call-shape",
      options: {},
    },
    {
      name: "abstains on type-only re-exports",
      files: typeOnlyFiles,
      reason: "unsupported-call-shape",
      options: {},
    },
    {
      name: "abstains when import resolution escapes the workspace",
      files: escapingFiles,
      reason: "unsupported-call-shape",
      options: {},
    },
    {
      name: "abstains on unsupported package specifiers",
      files: unsupportedSpecifierFiles,
      reason: "unsupported-call-shape",
      options: {},
    },
    {
      name: "abstains when module-path resolution has two source files",
      files: ambiguousPathFiles,
      reason: "unsupported-call-shape",
      options: {},
    },
    {
      name: "abstains when a file on the chain lacks complete re-export facts",
      files: incompleteChainFiles,
      reason: "incomplete-inventory",
      options: { incompleteReexportInventoryFile: "src/barrel.ts" },
    },
    {
      name: "abstains when the final file lacks complete re-export facts",
      files: incompleteTargetFiles,
      reason: "incomplete-inventory",
      options: { incompleteReexportInventoryFile: "src/impl.ts" },
    },
    {
      name: "abstains when the candidate list is truncated",
      files: truncatedFiles,
      reason: "candidate-list-truncated",
      options: { maxCandidates: 1 },
    },
    {
      name: "abstains when the final target name collides in the workspace",
      files: collisionFiles,
      reason: "no-unique-owner-candidate",
      options: {},
    },
  ])("$name", async ({ files, reason, options }) => {
    const result = await hypothesize(files, options);
    expect(result.strictProof).toEqual({
      status: "abstained",
      targetKey: null,
      ruleSignature: null,
      reason,
    });
  });
});
