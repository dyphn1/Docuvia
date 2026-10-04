import { describe, expect, it } from "vitest";
import type { CallResolutionConfiguredPathAliases } from "@workspace/contracts";
import { resolveDirectConfiguredImportPath } from "./call-resolution-hypothesis-index.js";

const evidence: CallResolutionConfiguredPathAliases = {
  configurationFilePath: "tsconfig.json",
  sourceContentHash: "a".repeat(64),
  paths: { "@/*": ["./src/*"] },
  baseUrl: null,
  extends: [],
};

const resolve = (
  modulePath: string,
  files: readonly string[],
  config = evidence,
) =>
  resolveDirectConfiguredImportPath("src/caller.ts", modulePath, files, config);

describe("configured path import resolution", () => {
  it("[happy] resolves one explicit root-local mapping to one exact source path", () => {
    expect(resolve("@/lib/worker", ["src/lib/worker.ts"])).toBe(
      "src/lib/worker.ts",
    );
    expect(resolve("@/lib/worker.js", ["src/lib/worker.ts"])).toBe(
      "src/lib/worker.ts",
    );
  });

  it("[invalid-input] rejects absent, stale, inherited, multiple, or non-root config evidence", () => {
    const patches: Partial<CallResolutionConfiguredPathAliases>[] = [
      { sourceContentHash: "stale" },
      { configurationFilePath: "config/tsconfig.json" },
      { baseUrl: "." },
      { extends: ["./base.json"] },
      { paths: { "@/*": ["./src/*", "./other/*"] } },
      { paths: { "@/*": ["./src/*"], "@/worker": ["./other.ts"] } },
    ];
    expect({
      valid: resolve("@/worker", ["src/worker.ts"]),
      absent: resolveDirectConfiguredImportPath(
        "src/caller.ts",
        "@/worker",
        ["src/worker.ts"],
        undefined,
      ),
      rejected: patches.map((patch) =>
        resolve("@/worker", ["src/worker.ts"], { ...evidence, ...patch }),
      ),
    }).toStrictEqual({
      valid: "src/worker.ts",
      absent: undefined,
      rejected: [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    });
  });

  it("[error-handling] keeps ambiguous extensions and duplicate paths unresolved", () => {
    expect({
      valid: resolve("@/worker", ["src/worker.ts"]),
      extensions: resolve("@/worker", ["src/worker.ts", "src/worker.tsx"]),
      duplicate: resolve("@/worker", ["src/worker.ts", "src/worker.ts"]),
      barrel: resolve("@/worker", ["src/worker/index.ts"]),
    }).toStrictEqual({
      valid: "src/worker.ts",
      extensions: undefined,
      duplicate: undefined,
      barrel: undefined,
    });
  });

  it("[invalid-input] rejects traversal, encoded paths, package paths, and absolute callers", () => {
    const specifiers = [
      "@/../outside",
      "@/a/../../outside",
      "@/a%2fworker",
      "@/worker?raw",
      "@/worker#fragment",
      "@/a\\worker",
      "package",
      "./worker",
    ];
    expect({
      valid: resolve("@/worker", ["src/worker.ts"]),
      rejected: specifiers.map((specifier) =>
        resolve(specifier, ["src/worker.ts", "outside.ts"]),
      ),
      absoluteCaller: resolveDirectConfiguredImportPath(
        "/src/caller.ts",
        "@/worker",
        ["src/worker.ts"],
        evidence,
      ),
    }).toStrictEqual({
      valid: "src/worker.ts",
      rejected: [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
      absoluteCaller: undefined,
    });
  });
});
