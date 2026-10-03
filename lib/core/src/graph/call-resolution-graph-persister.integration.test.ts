import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createPortableCallSiteKey } from "@workspace/contracts";
import { GraphStore } from "@workspace/schema";
import { CallResolutionHypothesisService } from "../semantic/call-resolution-hypothesis.service.js";
import { buildParseResponse } from "../ast/ast-worker.js";
import { GraphPersisterService } from "./phase393-graph-persister.js";

describe("GraphPersister call-resolution integration", () => {
  let store: GraphStore | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (store) await store.close();
    store = undefined;
    if (tempDir) {
      const fs = await import("node:fs");
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDir = undefined;
  });

  async function persistSource(
    code: string,
    sourceIndexComplete = true,
  ): Promise<{
    projectId: number;
    filePath: string;
    sourceContentHash: string;
    parsedData: NonNullable<
      Awaited<ReturnType<typeof buildParseResponse>>["data"]
    >;
  }> {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-call-resolution-persister-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "call-resolution",
      repoUrl: "file:///call-resolution",
    }).id;
    const filePath = "src/service.ts";
    fs.mkdirSync(path.dirname(path.join(tempDir, filePath)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(tempDir, filePath), code, "utf8");
    const sourceContentHash = createHash("sha256")
      .update(code, "utf8")
      .digest("hex");
    const parsed = await buildParseResponse({
      taskId: "call-resolution-persister",
      filePath,
      code,
      language: "typescript",
    });
    if (!parsed.success || !parsed.data)
      throw new Error(parsed.error ?? "AST worker omitted file data");

    await new GraphPersisterService(
      new CallResolutionHypothesisService(),
    ).persist({
      store,
      workspaceRoot: tempDir,
      projectId,
      parsedResults: [
        { file: filePath, hash: sourceContentHash, data: parsed.data },
      ],
      sourceIndexComplete,
      tags: [],
    });

    return { projectId, filePath, sourceContentHash, parsedData: parsed.data };
  }

  function projectedCallKeys(): Array<{ source: string; target: string }> {
    if (!store) throw new Error("GraphStore was not initialized");
    const nodeKeyById = new Map(
      store.graph
        .getAllNodes()
        .map((node) => [node.id, node.node_key] as const),
    );
    return store.graph
      .getAllLinks()
      .filter((link) => link.link_type === "calls")
      .map((link) => ({
        source: nodeKeyById.get(link.source_node_id) ?? "",
        target: nodeKeyById.get(link.target_node_id) ?? "",
      }));
  }

  it("[happy][state-diff] persists the exact portable identity and projects a proven unique this-member target", async () => {
    const code = [
      "export class Service {",
      "  close(): void {}",
      "  call(): void { this.close(); }",
      "}",
      "",
    ].join("\n");
    const { projectId, filePath, sourceContentHash, parsedData } =
      await persistSource(code);
    if (!store) throw new Error("GraphStore was not initialized");
    const callSite = parsedData.callSiteShapeFacts?.callSites.find(
      (candidate) => candidate.calleeName === "close",
    );
    expect(callSite).toMatchObject({ calleeName: "close" });
    if (!callSite) throw new Error("AST worker omitted source call-site facts");

    const callSiteKey = createPortableCallSiteKey({
      filePath,
      sourceContentHash,
      startLine: callSite.startLine,
      startColumn: callSite.startColumn,
      calleeKind: callSite.calleeKind,
      calleeName: callSite.calleeName,
    });
    const resolution = store.callSiteResolutions
      ?.getForFile(projectId, filePath)
      .find((candidate) => candidate.callSiteKey === callSiteKey);

    expect(resolution).toMatchObject({
      callSiteKey,
      identityVersion: 1,
      filePath,
      sourceContentHash,
      startLine: callSite.startLine,
      startColumn: callSite.startColumn,
      calleeKind: callSite.calleeKind,
      calleeName: callSite.calleeName,
      callerNodeKey: `${filePath}#Service.call`,
      resolutionClass: "proven",
      selectedTargetNodeKey: `${filePath}#Service.close`,
      confidence: null,
      resolver: "strict-proof",
      ruleSignature: "single-candidate-this-v1",
      verificationStatus: "unverified",
      isStale: false,
    });
    expect(resolution?.candidates).toHaveLength(1);

    expect(projectedCallKeys()).toContainEqual({
      source: `${filePath}#Service.call`,
      target: `${filePath}#Service.close`,
    });
  });

  it("[invalid-input][error-handling][state-diff] keeps the legacy ScopeResolver edge when the source index is incomplete", async () => {
    const code =
      "class Service { close(): void {} call(): void { this.close(); } }";
    const { filePath, projectId } = await persistSource(code, false);

    expect(store?.callSiteResolutions?.getForFile(projectId, filePath)).toEqual(
      [],
    );
    expect(projectedCallKeys()).toContainEqual({
      source: `${filePath}#Service.call`,
      target: `${filePath}#Service.close`,
    });
  });

  it("[invalid-input][error-handling][state-diff] abstains on overload collisions and keeps the legacy edge", async () => {
    const code = [
      "class Service {",
      "  close(value: string): void;",
      "  close(value: number): void {}",
      '  call(): void { this.close("x"); }',
      "}",
    ].join("\n");
    const { filePath, projectId } = await persistSource(code);

    expect(store?.callSiteResolutions?.getForFile(projectId, filePath)).toEqual(
      [],
    );
    expect(projectedCallKeys()).toContainEqual({
      source: `${filePath}#Service.call`,
      target: `${filePath}#Service.close`,
    });
  });

  it("[invalid-input][error-handling][state-diff] abstains for a non-class receiver and keeps the legacy edge", async () => {
    const code =
      "class Service { close(): void {} call(other: Service): void { other.close(); } }";
    const { filePath, projectId } = await persistSource(code);

    expect(store?.callSiteResolutions?.getForFile(projectId, filePath)).toEqual(
      [],
    );
    expect(projectedCallKeys()).toContainEqual({
      source: `${filePath}#Service.call`,
      target: `${filePath}#Service.close`,
    });
  });

  it("[stress][state-diff] repeated full reparses keep the proven calls projection idempotent", async () => {
    const code =
      "class Service { close(): void {} call(): void { this.close(); } }";
    const { projectId, filePath } = await persistSource(code);
    if (!store || !tempDir)
      throw new Error("GraphStore workspace was not initialized");
    const expectedCalls = projectedCallKeys();

    for (let iteration = 0; iteration < 4; iteration++) {
      const sourceContentHash = createHash("sha256")
        .update(code, "utf8")
        .digest("hex");
      const parsed = await buildParseResponse({
        taskId: `call-resolution-reparse-${iteration}`,
        filePath,
        code,
        language: "typescript",
      });
      if (!parsed.success || !parsed.data)
        throw new Error(parsed.error ?? "AST worker omitted file data");

      await new GraphPersisterService(
        new CallResolutionHypothesisService(),
      ).persist({
        store,
        workspaceRoot: tempDir,
        projectId,
        parsedResults: [
          { file: filePath, hash: sourceContentHash, data: parsed.data },
        ],
        sourceIndexComplete: true,
        tags: [],
      });
    }

    expect(projectedCallKeys()).toEqual(expectedCalls);
    expect(
      store.callSiteResolutions?.getForFile(projectId, filePath),
    ).toHaveLength(1);
  });
});
