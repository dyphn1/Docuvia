import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  replayPartialSemanticRows,
  type PartialSemanticReplaySite,
} from "../../scripts/semantic-corpus/phase0-partial-semantic-replay.mts";
import { createPartialSemanticProject } from "../../scripts/semantic-corpus/phase0-partial-semantic.mts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "phase0-partial-replay-"));
  temporaryRoots.push(root);
  for (const [filePath, contents] of Object.entries(files)) {
    const absolute = path.join(root, filePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

function callSite(input: {
  readonly sampleId: string;
  readonly snapshotId: string;
  readonly projectId: string;
  readonly filePath: string;
  readonly source: string;
  readonly calleeName?: string;
  readonly positionStatus?: string;
  readonly exclusionReason?: string;
}): PartialSemanticReplaySite {
  const calleeName = input.calleeName ?? "target";
  const offsetUtf16 = input.source.lastIndexOf(calleeName);
  const before = input.source.slice(0, offsetUtf16);
  const line = before.split("\n").length - 1;
  const linePrefix = before.slice(before.lastIndexOf("\n") + 1);
  return {
    sampleId: input.sampleId,
    snapshotId: input.snapshotId,
    projectId: input.projectId,
    callSiteKey: `site:${input.sampleId}`,
    filePath: input.filePath,
    line,
    column: Buffer.byteLength(linePrefix, "utf8"),
    offsetUtf16,
    calleeKind: "bare",
    calleeName,
    positionStatus: input.positionStatus ?? "unique",
    ...(input.exclusionReason
      ? { exclusionReason: input.exclusionReason }
      : {}),
  };
}

describe("Phase 0 PartialSemantic corpus-row replay adapter", () => {
  it("[happy] queries one real PartialSemantic project per exact projectId and keeps labels out", () => {
    const snapshotId = "snapshot-1";
    const source = 'import { target } from "./target";\ntarget();\n';
    const snapshotRoot = fixture({
      "a/tsconfig.json": JSON.stringify({
        compilerOptions: { module: "commonjs", target: "ES2022" },
        files: ["caller.ts", "target.ts"],
      }),
      "a/caller.ts": source,
      "a/target.ts": "export function target() {}\n",
      "b/tsconfig.json": JSON.stringify({
        compilerOptions: { module: "commonjs", target: "ES2022" },
        files: ["caller.ts", "target.ts"],
      }),
      "b/caller.ts": source,
      "b/target.ts": "export function target() {}\n",
    });
    const sites = [
      callSite({
        sampleId: "sample-a",
        snapshotId,
        projectId: "a/tsconfig.json",
        filePath: "a/caller.ts",
        source,
      }),
      callSite({
        sampleId: "sample-b",
        snapshotId,
        projectId: "b/tsconfig.json",
        filePath: "b/caller.ts",
        source,
      }),
      {
        ...callSite({
          sampleId: "sample-unmapped",
          snapshotId,
          projectId: "a/tsconfig.json",
          filePath: "a/caller.ts",
          source,
        }),
        callSiteKey: null,
        line: null,
        column: null,
        offsetUtf16: null,
        positionStatus: "excluded",
        exclusionReason: "no-worker-call-at-position",
        oracleTargetIds: ["label-must-not-escape"],
      } as PartialSemanticReplaySite,
    ];

    const result = replayPartialSemanticRows({
      snapshotRoot,
      snapshotId,
      sites,
      snapshotFiles: new Set([
        "a/tsconfig.json",
        "a/caller.ts",
        "a/target.ts",
        "b/tsconfig.json",
        "b/caller.ts",
        "b/target.ts",
      ]),
    });

    expect(result.rows).toHaveLength(sites.length);
    expect(result.rows.map((row) => row.sampleId)).toEqual([
      "sample-a",
      "sample-b",
      "sample-unmapped",
    ]);
    expect(result.rows[0]).toMatchObject({
      evidenceKind: "tier-b0-measurement-only",
      status: "resolved",
      definitions: [
        expect.objectContaining({
          filePath: "a/target.ts",
          symbolName: "target",
          external: false,
        }),
      ],
      latencyMs: expect.any(Number),
    });
    const directProject = createPartialSemanticProject({
      snapshotRoot,
      projectId: "a/tsconfig.json",
      snapshotFiles: new Set(["a/tsconfig.json", "a/caller.ts", "a/target.ts"]),
    });
    try {
      const direct = directProject.query({
        filePath: sites[0].filePath,
        line: sites[0].line,
        column: sites[0].column,
        offsetUtf16: sites[0].offsetUtf16,
        calleeKind: sites[0].calleeKind,
        calleeName: sites[0].calleeName,
        positionStatus: sites[0].positionStatus,
      });
      expect(result.rows[0].definitions[0]).toMatchObject({
        filePath: direct.definitions[0]?.filePath,
        startLine: direct.definitions[0]?.startLine,
        startColumn: direct.definitions[0]?.startColumn,
        endLine: direct.definitions[0]?.endLine,
        endColumn: direct.definitions[0]?.endColumn,
        symbolName: direct.definitions[0]?.symbolName,
        external: direct.definitions[0]?.external,
      });
      expect(result.rows[0].definitions[0]?.containerName).toBe('"a/target"');
    } finally {
      directProject.close();
    }
    expect(result.rows[1]).toMatchObject({ status: "resolved" });
    expect(result.rows[2]).toMatchObject({
      callSiteKey: null,
      status: "invalid-position",
      reason: "no-worker-call-at-position",
      definitions: [],
    });
    expect(result.projects.map((project) => project.projectId)).toEqual([
      "a/tsconfig.json",
      "b/tsconfig.json",
    ]);
    expect(result.projects.every((project) => project.status === "ready")).toBe(
      true,
    );
    expect(result.projects[0]).toMatchObject({
      languageServiceMode: "PartialSemantic",
      configHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      compilerOptions: { noResolve: true, types: [] },
      rootFiles: expect.arrayContaining(["a/caller.ts"]),
      programFiles: expect.arrayContaining(["a/caller.ts"]),
      startupMs: expect.any(Number),
      readyMs: expect.any(Number),
    });
    expect(JSON.stringify(result.rows)).not.toContain(snapshotRoot);
    expect(JSON.stringify(result.projects)).not.toContain(snapshotRoot);
    expect(JSON.stringify(result)).not.toContain("label-must-not-escape");
    expect(result.rows[0]).not.toHaveProperty("oracleTargetIds");
  });

  it("[error-handling] preserves every input as a redacted error row when project initialization fails", () => {
    const snapshotId = "snapshot-broken";
    const caller = "function target() {}\ntarget();\n";
    const snapshotRoot = fixture({
      "bad/tsconfig.json": "{ invalid json",
      "bad/caller.ts": caller,
    });
    const base = callSite({
      sampleId: "valid-position",
      snapshotId,
      projectId: "bad/tsconfig.json",
      filePath: "bad/caller.ts",
      source: caller,
    });
    const sites = [
      base,
      {
        ...base,
        sampleId: "unmapped-position",
        callSiteKey: null,
        line: null,
        column: null,
        offsetUtf16: null,
        positionStatus: "excluded",
        exclusionReason: "invalid-source-position",
      },
    ];

    const result = replayPartialSemanticRows({
      snapshotRoot,
      snapshotId,
      sites,
      snapshotFiles: new Set(["bad/tsconfig.json", "bad/caller.ts"]),
    });

    expect(result.rows).toHaveLength(sites.length);
    expect(result.rows.map((row) => row.status)).toEqual(["error", "error"]);
    expect(result.rows.map((row) => row.sampleId)).toEqual([
      "valid-position",
      "unmapped-position",
    ]);
    expect(result.rows.every((row) => row.definitions.length === 0)).toBe(true);
    expect(result.projects).toEqual([
      expect.objectContaining({
        projectId: "bad/tsconfig.json",
        status: "initialization-error",
        inputSiteCount: 2,
        queriedSiteCount: 0,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(snapshotRoot);
  });

  it("[invalid-input] records snapshot mismatches without querying across snapshot boundaries", () => {
    const snapshotId = "actual-snapshot";
    const caller = "target();\n";
    const snapshotRoot = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["caller.ts"],
      }),
      "caller.ts": caller,
    });
    const site = callSite({
      sampleId: "wrong-snapshot",
      snapshotId: "other-snapshot",
      projectId: "tsconfig.json",
      filePath: "caller.ts",
      source: caller,
    });

    const result = replayPartialSemanticRows({
      snapshotRoot,
      snapshotId,
      sites: [site],
      snapshotFiles: new Set(["tsconfig.json", "caller.ts"]),
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      sampleId: "wrong-snapshot",
      snapshotId: "other-snapshot",
      status: "error",
      reason: "site-snapshot-mismatch",
      definitions: [],
    });
    expect(result.projects).toEqual([
      expect.objectContaining({
        projectId: "tsconfig.json",
        status: "snapshot-mismatch",
        inputSiteCount: 1,
        queriedSiteCount: 0,
      }),
    ]);
  });
});
