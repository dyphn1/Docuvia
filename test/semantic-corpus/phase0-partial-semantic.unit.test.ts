import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  classifyPartialSemanticDefinitions,
  createPartialSemanticProject,
  type PartialSemanticCallSite,
  type PartialSemanticProject,
  type PartialSemanticProjectOptions,
} from "../../scripts/semantic-corpus/phase0-partial-semantic.mts";

interface Fixture {
  readonly root: string;
  readonly files: ReadonlySet<string>;
}

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(files: Readonly<Record<string, string>>): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "phase0-partial-semantic-"));
  temporaryRoots.push(root);
  for (const [filePath, contents] of Object.entries(files)) {
    const absolute = path.join(root, filePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return { root, files: new Set(Object.keys(files)) };
}

function callSite(
  source: string,
  calleeName: string,
  extra: Partial<PartialSemanticCallSite> = {},
): PartialSemanticCallSite {
  const offsetUtf16 = extra.offsetUtf16 ?? source.lastIndexOf(calleeName);
  const before = source.slice(0, Math.max(0, offsetUtf16));
  const line = before.split("\n").length - 1;
  const linePrefix = before.slice(before.lastIndexOf("\n") + 1);
  return {
    filePath: "caller.ts",
    line,
    column: Buffer.byteLength(linePrefix, "utf8"),
    offsetUtf16,
    calleeKind: "bare",
    calleeName,
    ...extra,
  };
}

function withProject<T>(
  fixtureRoot: Fixture,
  run: (project: PartialSemanticProject) => T,
  extra: Partial<PartialSemanticProjectOptions> = {},
): T {
  const project = createPartialSemanticProject({
    snapshotRoot: fixtureRoot.root,
    projectId: "tsconfig.json",
    snapshotFiles: fixtureRoot.files,
    ...extra,
  });
  try {
    return run(project);
  } finally {
    project.close();
  }
}

describe("Phase 0 TypeScript PartialSemantic measurement helper", () => {
  it("[happy] opens the actual PartialSemantic mode and returns root-file definitions", () => {
    const caller = `import { invokeMe } from "./target";\ninvokeMe();\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "commonjs", target: "ES2022" },
        files: ["caller.ts", "target.ts"],
      }),
      "caller.ts": caller,
      "target.ts": "export function invokeMe(): void {}\n",
    });
    let actualMode: ts.LanguageServiceMode | undefined;
    let actualNoResolve = false;
    let actualTypes: readonly string[] | undefined;

    withProject(
      source,
      (project) => {
        expect(actualMode).toBe(ts.LanguageServiceMode.PartialSemantic);
        expect(actualNoResolve).toBe(true);
        expect(actualTypes).toEqual([]);
        expect(project.metadata.languageServiceMode).toBe("PartialSemantic");
        expect(project.metadata.typescriptVersion).toBe("5.9.3");
        expect(project.metadata.rootFiles).toEqual(["caller.ts", "target.ts"]);
        expect(project.metadata.programFiles).toContain("target.ts");
        expect(project.metadata.configHash).toMatch(/^[a-f0-9]{64}$/);

        const result = project.query(callSite(caller, "invokeMe"));
        expect(result.status).toBe("resolved");
        expect(result.latencyMs).toEqual(expect.any(Number));
        expect(result.definitions).toEqual([
          expect.objectContaining({
            filePath: "target.ts",
            symbolName: "invokeMe",
            external: false,
          }),
        ]);
      },
      {
        createLanguageService: (host, mode) => {
          actualMode = mode;
          const compilerOptions = host.getCompilationSettings();
          actualNoResolve = compilerOptions.noResolve === true;
          actualTypes = compilerOptions.types;
          return ts.createLanguageService(host, undefined, mode);
        },
      },
    );
  });

  it("[happy] validates a qualified constructor as a constructor call", () => {
    const caller = `namespace Factory { export class Worker {} }\nnew Factory.Worker();\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
    });

    withProject(source, (project) => {
      const result = project.query(
        callSite(caller, "Worker", { calleeKind: "constructor" }),
      );
      expect(result.status).toBe("resolved");
      expect(result.definitions).toEqual([
        expect.objectContaining({
          filePath: "caller.ts",
          symbolName: "Worker",
          external: false,
        }),
      ]);
    });
  });

  it("[boundary] records the real import-alias result when noResolve omits its target", () => {
    const caller = `import { invokeMe } from "./target";\ninvokeMe();\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "commonjs", target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
      "target.ts": "export function invokeMe(): void {}\n",
    });

    withProject(source, (project) => {
      expect(project.metadata.rootFiles).toEqual(["caller.ts"]);
      expect(project.metadata.programFiles).not.toContain("target.ts");
      const result = project.query(callSite(caller, "invokeMe"));
      expect(result.status).toBe("resolved");
      expect(result.definitions).toEqual([
        expect.objectContaining({
          filePath: "caller.ts",
          startLine: 0,
          startColumn: 9,
          symbolName: "invokeMe",
          external: false,
        }),
      ]);
    });
  });

  it("[boundary] hashes the same effective config identically across snapshot roots", () => {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": "invokeMe();\n",
    };
    const first = fixture(files);
    const second = fixture(files);
    const firstHash = withProject(
      first,
      (project) => project.metadata.configHash,
    );
    const secondHash = withProject(
      second,
      (project) => project.metadata.configHash,
    );
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(secondHash).toBe(firstHash);
  });

  it("[happy] validates UTF-16 offsets against Tree-sitter byte columns after astral Unicode", () => {
    const caller = `function invokeMe() {}\nconst marker = "😀"; invokeMe();\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
    });

    withProject(source, (project) => {
      const correctOffset = caller.lastIndexOf("invokeMe");
      const correct = project.query(
        callSite(caller, "invokeMe", { offsetUtf16: correctOffset }),
      );
      expect(correct.status).toBe("resolved");
      expect(correct.definitions[0]).toEqual(
        expect.objectContaining({ filePath: "caller.ts", external: false }),
      );

      const linePrefix = `const marker = "😀"; `;
      const byteColumn = Buffer.byteLength(linePrefix, "utf8");
      const utf16Column = linePrefix.length;
      expect(byteColumn).not.toBe(utf16Column);
      const stale = project.query(
        callSite(caller, "invokeMe", {
          offsetUtf16: caller.indexOf(linePrefix) + byteColumn,
        }),
      );
      expect(stale.status).toBe("invalid-position");
      expect(stale.reason).toBe("callee-offset-not-at-token-start");
    });
  });

  it("[invalid-input] abstains when a sidecar position or callee identity is stale", () => {
    const caller = `function invokeMe() {}\ninvokeMe();\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
    });

    withProject(source, (project) => {
      expect(
        project.query(callSite(caller, "invokeMe", { calleeKind: "member" })),
      ).toMatchObject({
        status: "invalid-position",
        reason: "callee-kind-mismatch",
      });
      expect(
        project.query(
          callSite(caller, "invokeMe", { calleeName: "staleName" }),
        ),
      ).toMatchObject({
        status: "invalid-position",
        reason: "callee-token-mismatch",
      });
      expect(
        project.query(callSite(caller, "invokeMe", { column: 99 })),
      ).toMatchObject({
        status: "invalid-position",
        reason: "callee-byte-position-mismatch",
      });
      expect(
        project.query(
          callSite(caller, "invokeMe", { positionStatus: "ambiguous" }),
        ),
      ).toMatchObject({ status: "invalid-position", reason: "ambiguous" });
    });
  });

  it("[boundary] distinguishes no-result and TypeScript-library-only definitions", () => {
    const caller = `missingCall();\nconsole.log("x");\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM"] },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
    });

    withProject(source, (project) => {
      const missing = project.query(callSite(caller, "missingCall"));
      expect(missing).toMatchObject({
        status: "no-result",
        reason: "definition-not-found",
        definitions: [],
        latencyMs: expect.any(Number),
      });

      const external = project.query(
        callSite(caller, "log", {
          offsetUtf16: caller.lastIndexOf("log("),
          calleeKind: "member",
        }),
      );
      expect(external.status).toBe("external-only");
      expect(external.definitions).toHaveLength(1);
      expect(external.definitions[0]).toEqual(
        expect.objectContaining({
          filePath: expect.stringMatching(/^typescript\//),
          symbolName: "log",
          external: true,
        }),
      );
    });
  });

  it("[boundary] classifies multiple and mixed raw definition sets without dropping refs", () => {
    const local = { external: false } as const;
    const external = { external: true } as const;
    expect(classifyPartialSemanticDefinitions([local, local])).toEqual({
      status: "multiple-definitions",
      reason: "multiple-local-definitions",
    });
    expect(classifyPartialSemanticDefinitions([local, external])).toEqual({
      status: "mixed",
      reason: "local-and-external-definitions",
    });
    expect(
      classifyPartialSemanticDefinitions([external, external]).status,
    ).toBe("external-only");
  });

  it("[invalid-input] keeps unsupported and out-of-project rows observable", () => {
    const caller = `function invokeMe() {}\ninvokeMe();\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
      "other.ts": "invokeMe();\n",
    });

    withProject(source, (project) => {
      expect(
        project.query(callSite(caller, "invokeMe", { calleeKind: null })),
      ).toMatchObject({ status: "unsupported", reason: "missing-callee-kind" });
      expect(
        project.query(callSite(caller, "invokeMe", { filePath: "other.ts" })),
      ).toMatchObject({
        status: "unsupported",
        reason: "source-file-not-in-partial-project",
      });
      expect(
        project.query(
          callSite(caller, "invokeMe", { filePath: "../outside.ts" }),
        ),
      ).toMatchObject({
        status: "unsupported",
        reason: "source-path-escapes-snapshot",
      });
      expect(
        project.query(
          callSite(caller, "invokeMe", { offsetUtf16: caller.length + 1 }),
        ),
      ).toMatchObject({
        status: "invalid-position",
        reason: "callee-offset-out-of-range",
      });
    });
  });

  it("[error-handling] retains typed language-service failures and disposes once", () => {
    const caller = `function invokeMe() {}\ninvokeMe();\n`;
    const source = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
    });
    let disposeCount = 0;

    withProject(
      source,
      (project) => {
        const result = project.query(callSite(caller, "invokeMe"));
        expect(result).toMatchObject({
          status: "error",
          reason: "synthetic definition failure",
          definitions: [],
          latencyMs: expect.any(Number),
        });
        project.close();
        expect(project.query(callSite(caller, "invokeMe"))).toMatchObject({
          status: "error",
          reason: "partial-project-closed",
        });
      },
      {
        createLanguageService: (host, mode) => {
          const service = ts.createLanguageService(host, undefined, mode);
          return new Proxy(service, {
            get(target, property) {
              if (property === "getDefinitionAtPosition")
                return () => {
                  throw new Error("synthetic definition failure");
                };
              if (property === "dispose")
                return () => {
                  disposeCount += 1;
                  target.dispose();
                };
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            },
          }) as ts.LanguageService;
        },
      },
    );
    expect(disposeCount).toBe(1);
  });
});
