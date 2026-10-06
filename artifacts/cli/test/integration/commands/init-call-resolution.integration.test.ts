import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  AnalyzeResultKind,
  createNoopLogger,
  docuviaFactory,
  docuviaMemory,
  MemoryKeys,
  TOKENS,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { TestSandbox } from "../../support/sandbox.js";
import "../../../src/registration.js";

const methodRendererSource = [
  "export class EvalMethodRenderer {",
  '  evalRenderMethod(): string { return "x"; }',
  "}",
  "",
].join("\n");

const methodHostSource = [
  'import { EvalMethodRenderer } from "./method-renderer";',
  "export function evalMethodRenderHost(): void {",
  "  const renderer = new EvalMethodRenderer();",
  "  renderer.evalRenderMethod();",
  "}",
  "",
].join("\n");

async function openGraphStore(workspaceRoot: string) {
  return docuviaFactory.resolve(TOKENS.GraphStoreOpener)({
    dbPath: path.join(workspaceRoot, ".docuvia", "local.db"),
  });
}

async function expectInitProofAndCallEdge(
  workspaceRoot: string,
  expectedHostBlobHash: string,
): Promise<void> {
  const store = await openGraphStore(workspaceRoot);
  try {
    const project = store.projects.getFirst();
    if (!project) throw new Error("Init did not persist the project row");
    const resolutions =
      store.callSiteResolutions?.getAllForProject(project.id) ?? [];
    expect(resolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "src/method-render-host.ts",
          sourceContentHash: createHash("sha256")
            .update(methodHostSource, "utf8")
            .digest("hex"),
          resolutionClass: "proven",
          resolver: "strict-proof",
          ruleSignature: "q3:new-receiver:v1",
        }),
      ]),
    );
    expect(
      store.files
        .getAllHashes()
        .find(({ filePath }) => filePath === "src/method-render-host.ts")
        ?.contentHash,
    ).toBe(expectedHostBlobHash);

    const nodeKeyById = new Map(
      store.graph
        .getAllNodes()
        .map((node) => [node.id, node.node_key] as const),
    );
    const calls = store.graph
      .getAllLinks()
      .filter((link) => link.link_type === "calls")
      .map((link) => ({
        source: nodeKeyById.get(link.source_node_id),
        target: nodeKeyById.get(link.target_node_id),
      }));
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.stringContaining("evalMethodRenderHost"),
          target: expect.stringContaining(
            "EvalMethodRenderer.evalRenderMethod",
          ),
        }),
      ]),
    );
  } finally {
    await store.close();
  }
}

function expectImpactShowsProvenCaller(
  impact: Awaited<ReturnType<typeof docuviaApi.impact>>,
): void {
  expect(
    impact?.callResolutionBreakdown?.verifiedProven,
  ).toBeGreaterThanOrEqual(1);
  const host = impact?.blastRadius.find(
    (entry) => entry.name === "evalMethodRenderHost",
  );
  expect(
    host?.callResolutions?.some(
      (resolution) => resolution.resolutionClass === "proven",
    ),
  ).toBe(true);
}

async function commitCallerDelta(sandbox: TestSandbox): Promise<void> {
  const changedHost = methodHostSource.replace(
    "renderer.evalRenderMethod();",
    "renderer.evalRenderMethod(); // delta reparse",
  );
  const fs = await import("node:fs/promises");
  await fs.writeFile(
    path.join(sandbox.dir, "src/method-render-host.ts"),
    changedHost,
    "utf8",
  );
  await sandbox.runGit(["add", "src/method-render-host.ts"]);
  await sandbox.runGit(["commit", "-m", "change caller"]);
}

async function commitUnrelatedDelta(sandbox: TestSandbox): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(
    path.join(sandbox.dir, "src/unrelated.ts"),
    "export const unrelatedValue = 2;\n",
    "utf8",
  );
  await sandbox.runGit(["add", "src/unrelated.ts"]);
  await sandbox.runGit(["commit", "-m", "change unrelated file"]);
}

async function expectExistingProofRemainsProven(
  workspaceRoot: string,
): Promise<void> {
  const store = await openGraphStore(workspaceRoot);
  try {
    const project = store.projects.getFirst();
    if (!project) throw new Error("Delta ingestion lost the project row");
    expect(
      store.callSiteResolutions
        ?.getAllForProject(project.id)
        .find(
          ({ filePath, ruleSignature }) =>
            filePath === "src/method-render-host.ts" &&
            ruleSignature === "q3:new-receiver:v1",
        ),
    ).toMatchObject({ resolutionClass: "proven", isStale: false });
  } finally {
    await store.close();
  }
}

async function expectDeltaDidNotReproveCaller(
  workspaceRoot: string,
): Promise<void> {
  const store = await openGraphStore(workspaceRoot);
  try {
    const project = store.projects.getFirst();
    if (!project) throw new Error("Delta ingestion lost the project row");
    const q3Resolutions = store.callSiteResolutions
      ?.getAllForProject(project.id)
      .filter(
        ({ filePath, ruleSignature }) =>
          filePath === "src/method-render-host.ts" &&
          ruleSignature === "q3:new-receiver:v1",
      );
    expect(q3Resolutions).toEqual([]);
  } finally {
    await store.close();
  }
}

async function expectStaleProjectedCallEdgeRemoved(
  workspaceRoot: string,
): Promise<void> {
  const store = await openGraphStore(workspaceRoot);
  try {
    const nodeKeyById = new Map(
      store.graph
        .getAllNodes()
        .map((node) => [node.id, node.node_key] as const),
    );
    const staleCallEdge = store.graph
      .getAllLinks()
      .filter((link) => link.link_type === "calls")
      .some((link) => {
        const source = nodeKeyById.get(link.source_node_id);
        const target = nodeKeyById.get(link.target_node_id);
        return (
          source?.includes("evalMethodRenderHost") &&
          target?.includes("EvalMethodRenderer.evalRenderMethod")
        );
      });
    expect(staleCallEdge).toBe(false);
  } finally {
    await store.close();
  }
}

describe("CLI full-ingestion call-site proofs", () => {
  let sandbox: TestSandbox;
  let scopeId: string;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    scopeId = `init-call-resolution-${Date.now()}`;
    await sandbox.setup({
      initGit: true,
      files: {
        "src/method-renderer.ts": methodRendererSource,
        "src/method-render-host.ts": methodHostSource,
        "src/unrelated.ts": "export const unrelatedValue = 1;\n",
      },
    });
    await sandbox.runGit(["add", "."]);
    await sandbox.runGit(["commit", "-m", "initial source"]);
    docuviaMemory.createScope(scopeId);
    docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, sandbox.dir);
  });

  afterEach(async () => {
    docuviaMemory.deleteScope(scopeId);
    await sandbox.teardown();
  });

  it("[happy][state-diff] proves the imported new receiver during real init and keeps delta conservative", async () => {
    const logger = createNoopLogger();
    await docuviaApi.init(scopeId, logger);
    const hostBlobHash = (
      await sandbox.runGit(["rev-parse", "HEAD:src/method-render-host.ts"])
    ).stdout.trim();
    await expectInitProofAndCallEdge(sandbox.dir, hostBlobHash);

    docuviaMemory.set(scopeId, MemoryKeys.TARGET, "evalRenderMethod");
    expectImpactShowsProvenCaller(await docuviaApi.impact(scopeId, logger));

    await commitUnrelatedDelta(sandbox);
    const unrelatedDeltaResult = await docuviaApi.analyze(scopeId, logger);
    expect(unrelatedDeltaResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
    await expectExistingProofRemainsProven(sandbox.dir);
    expectImpactShowsProvenCaller(await docuviaApi.impact(scopeId, logger));

    await commitCallerDelta(sandbox);
    const deltaResult = await docuviaApi.analyze(scopeId, logger);
    expect(deltaResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
    await expectDeltaDidNotReproveCaller(sandbox.dir);
    await expectStaleProjectedCallEdgeRemoved(sandbox.dir);

    const impactAfterDelta = await docuviaApi.impact(scopeId, logger);
    expect(impactAfterDelta?.callResolutionBreakdown?.verifiedProven ?? 0).toBe(
      0,
    );
  }, 120_000);
});
