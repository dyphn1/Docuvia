import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "../lib/contracts/src/testing/timeouts.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const collect = join(root, "scripts/semantic-corpus/collect.mts");
const replay = join(root, "scripts/semantic-corpus/replay.mts");
let temporary: string;
let revision: string;

interface Sample {
  sampleId: string;
  source: { callSiteId: string; split: string; snapshotHash: string };
  candidates: { id: string; targetId: string }[];
  oracle: { status: string; targetIds: string[]; snapshotHash: string };
  review: {
    status: string;
    positiveTargetIds: string[];
    negativeTargetIds: string[];
    evidenceRefs: string[];
  };
}

const FILES: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "NodeNext", target: "ES2022" },
    include: ["src"],
  }),
  "src/util.ts": "export function run(): number {\n  return 1;\n}\n",
  "src/other.ts": "export function run(): number {\n  return 2;\n}\n",
  "src/caller.ts": [
    'import { run } from "./util.js";',
    'import { run as go } from "./other.js";',
    "export function main(): number {",
    "  return run() + go();",
    "}",
    "",
  ].join("\n"),
};

function node(script: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: SUBPROCESS_TEST_TIMEOUT_MS,
  });
}

function runCollect(name: string) {
  const out = join(temporary, `out-${name}`);
  const child = node(collect, [
    "--spec",
    join(temporary, "spec.json"),
    "--repos",
    temporary,
    "--work",
    join(temporary, `work-${name}`),
    "--out",
    out,
  ]);
  expect(child.stderr).not.toMatch(/Error/);
  expect(child.status).toBe(0);
  return out;
}

function samplesOf(out: string): Sample[] {
  return JSON.parse(readFileSync(join(out, "corpus-manifest.json"), "utf8"))
    .samples;
}

beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), "docuvia-semantic-collect-"));
  const repo = join(temporary, "fixture");
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  }
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t.invalid",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t.invalid",
      },
    })
      .toString()
      .trim();
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["commit", "-q", "--no-verify", "-m", "fixture"]);
  revision = git(["rev-parse", "HEAD"]);
  writeFileSync(
    join(temporary, "spec.json"),
    JSON.stringify({
      corpusId: "e2e",
      corpusVersion: "1",
      splitSeed: "e2e-seed",
      maxSamplesPerSnapshot: 100,
      memoryFloorPercent: 1,
      tierAHeapMb: 1024,
      oracle: {
        requestTimeoutMs: 30000,
        readinessCapMs: 60000,
        readinessPollMs: 200,
        maxTsServerMemoryMb: 1024,
      },
      families: { "fixture/family": "train" },
      snapshots: [
        {
          snapshotId: "fixture",
          repoId: "example.invalid/fixture",
          family: "fixture/family",
          sourceDir: "fixture",
          revision,
          subtree: null,
          license: "MIT",
          usage: "training-and-evaluation",
          temporalOf: null,
        },
      ],
    }),
  );
}, SUBPROCESS_TEST_TIMEOUT_MS);
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe("semantic corpus collector (real Tier A, checker and LSP oracle)", () => {
  let first: string;

  it("[happy] labels a statically bound call with checker gold, oracle agreement and negatives", () => {
    first = runCollect("a");
    const direct = samplesOf(first).find((s) =>
      s.source.callSiteId.startsWith("src/caller.ts:3:9"),
    )!;
    expect(direct.review).toMatchObject({
      status: "confirmed",
      positiveTargetIds: ["src/util.ts#run"],
      negativeTargetIds: ["src/other.ts#run"],
    });
    expect(direct.oracle).toMatchObject({
      status: "resolved",
      targetIds: ["src/util.ts#run"],
    });
    expect(direct.review.evidenceRefs).toContain(
      "source-audit:match:src/util.ts",
    );
    // Both files are imported by the caller (rank 1), so node_key order decides (C-02).
    expect(direct.candidates.map((c) => c.targetId)).toEqual([
      "src/other.ts#run",
      "src/util.ts#run",
    ]);
  });

  it("[boundary] an aliased import stays in the corpus as a visible candidate miss", () => {
    const report = JSON.parse(
      readFileSync(join(first, "corpus-report.json"), "utf8"),
    );
    const aliased = samplesOf(first).find((s) =>
      s.source.callSiteId.startsWith("src/caller.ts:3:17"),
    )!;
    expect(aliased.candidates).toEqual([]);
    expect(aliased.review.positiveTargetIds).toEqual(["src/other.ts#run"]);
    const result = report.results.find(
      (r: { sampleId: string }) => r.sampleId === aliased.sampleId,
    );
    expect(result).toMatchObject({
      reason: "ready",
      missingTargetIds: ["src/other.ts#run"],
    });
    expect(report.real.candidateRecall).toBe(0.5);
  });

  it("[state-diff] every stage recomputes the same byte-verified snapshot hash", () => {
    const collection = JSON.parse(
      readFileSync(join(first, "collection-report.json"), "utf8"),
    );
    expect(collection.snapshots[0].snapshotHashesAgree).toBe(true);
    for (const sample of samplesOf(first))
      expect(sample.oracle.snapshotHash).toBe(sample.source.snapshotHash);
  });

  it("[stress] a second independent run replays identically", () => {
    const second = runCollect("b");
    const child = node(replay, ["--a", first, "--b", second]);
    const result = JSON.parse(child.stdout);
    expect(
      result.files.flatMap((f: { mismatches: string[] }) => f.mismatches),
    ).toEqual([]);
    expect(result.identical).toBe(true);
    expect(child.status).toBe(0);
  });

  it("[negative] replay reports a tampered correctness field", () => {
    const tampered = join(temporary, "out-tampered");
    cpSync(first, tampered, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(join(tampered, "corpus-manifest.json"), "utf8"),
    );
    manifest.samples[0].oracle.status = "empty";
    writeFileSync(
      join(tampered, "corpus-manifest.json"),
      JSON.stringify(manifest),
    );
    const child = node(replay, ["--a", first, "--b", tampered]);
    expect(child.status).toBe(2);
    expect(JSON.parse(child.stdout).files[0].mismatches).toEqual([
      "$.samples[0].oracle.status",
    ]);
  });

  it("[error-handling] a missing spec fails loudly without writing a manifest", () => {
    const out = join(temporary, "out-missing");
    const child = node(collect, [
      "--spec",
      join(temporary, "missing.json"),
      "--repos",
      temporary,
      "--work",
      join(temporary, "work-missing"),
      "--out",
      out,
    ]);
    expect(child.status).not.toBe(0);
    expect(() => readFileSync(join(out, "corpus-manifest.json"))).toThrow();
  });

  it("[invalid-input] rejects arguments it does not understand", () => {
    const child = node(collect, ["--spec"]);
    expect(child.status).not.toBe(0);
    expect(child.stderr).toMatch(/Usage/);
  });
});
