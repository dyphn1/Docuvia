import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
  createPortableCallSiteKey,
  type ParsedAstFileResult,
} from "@workspace/contracts";
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

  async function parseAndWriteSource(
    workspaceRoot: string,
    taskPrefix: string,
    source: { file: string; code: string },
  ): Promise<ParsedAstFileResult> {
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(path.dirname(path.join(workspaceRoot, source.file)), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceRoot, source.file),
      source.code,
      "utf8",
    );
    const parsed = await buildParseResponse({
      taskId: `${taskPrefix}-${source.file}`,
      filePath: source.file,
      code: source.code,
      language: "typescript",
    });
    if (!parsed.success || !parsed.data)
      throw new Error(parsed.error ?? `AST worker omitted ${source.file}`);
    return {
      file: source.file,
      hash: createHash("sha256").update(source.code, "utf8").digest("hex"),
      data: parsed.data,
    };
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

  it("[positive][state-diff] persists Q1 dependencies and reconstructs the same site after delete/reparse", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-q1-call-resolution-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "q1-call-resolution",
      repoUrl: "file:///q1-call-resolution",
    }).id;
    const sources = [
      {
        file: "src/implementation.ts",
        code: "export function shutdown(): void {}",
      },
      {
        file: "src/caller.ts",
        code: [
          'import { shutdown as finish } from "./implementation.js";',
          "export function call(): void { finish(); }",
        ].join("\n"),
      },
    ];
    const parsedResults = await Promise.all(
      sources.map(async ({ file, code }) => {
        fs.mkdirSync(path.dirname(path.join(tempDir!, file)), {
          recursive: true,
        });
        fs.writeFileSync(path.join(tempDir!, file), code, "utf8");
        const parsed = await buildParseResponse({
          taskId: `q1-call-resolution-${file}`,
          filePath: file,
          code,
          language: "typescript",
        });
        if (!parsed.success || !parsed.data)
          throw new Error(parsed.error ?? `AST worker omitted ${file}`);
        return {
          file,
          hash: createHash("sha256").update(code, "utf8").digest("hex"),
          data: parsed.data,
        };
      }),
    );
    const persist = () =>
      new GraphPersisterService(new CallResolutionHypothesisService()).persist({
        store: store!,
        workspaceRoot: tempDir!,
        projectId,
        parsedResults,
        sourceIndexComplete: true,
        tags: [],
      });

    const caller = parsedResults.find(({ file }) => file === "src/caller.ts");
    if (!caller) throw new Error("caller parse result is missing");
    const callSite = caller.data.callSiteShapeFacts?.callSites.find(
      ({ calleeName }) => calleeName === "finish",
    );
    if (!callSite) throw new Error("AST worker omitted the imported call site");
    await persist();
    const expectedKey = createPortableCallSiteKey({
      filePath: caller.file,
      sourceContentHash: caller.hash,
      startLine: callSite.startLine,
      startColumn: callSite.startColumn,
      calleeKind: callSite.calleeKind,
      calleeName: callSite.calleeName,
    });
    const dependencies = [
      { filePath: "src/caller.ts", contentHash: caller.hash },
      {
        filePath: "src/implementation.ts",
        contentHash: parsedResults.find(
          ({ file }) => file === "src/implementation.ts",
        )!.hash,
      },
    ];
    const dependencyFingerprint = createHash("sha256")
      .update(JSON.stringify(dependencies), "utf8")
      .digest("hex");
    const getQ1Resolution = () =>
      store?.callSiteResolutions
        ?.getForFile(projectId, caller.file)
        .find(({ callSiteKey }) => callSiteKey === expectedKey);

    expect(getQ1Resolution()).toMatchObject({
      callSiteKey: expectedKey,
      resolutionClass: "proven",
      selectedTargetNodeKey: "src/implementation.ts#shutdown",
      ruleSignature: "q1:named-import:v1",
      dependencies,
      dependencyFingerprint,
    });
    expect(projectedCallKeys()).toContainEqual({
      source: "src/caller.ts#call",
      target: "src/implementation.ts#shutdown",
    });

    store.callSiteResolutions?.deleteForFile(projectId, caller.file);
    expect(getQ1Resolution()).toBeUndefined();
    await persist();

    expect(getQ1Resolution()).toMatchObject({
      callSiteKey: expectedKey,
      selectedTargetNodeKey: "src/implementation.ts#shutdown",
      ruleSignature: "q1:named-import:v1",
      dependencies,
      dependencyFingerprint,
    });

    expect(
      store.callSiteResolutions?.invalidateChangedDependencies(projectId, [
        {
          filePath: "src/implementation.ts",
          contentHash: "e".repeat(64),
        },
      ]),
    ).toBe(1);
    expect(getQ1Resolution()).toMatchObject({ isStale: true });
    expect(projectedCallKeys()).not.toContainEqual({
      source: "src/caller.ts#call",
      target: "src/implementation.ts#shutdown",
    });
  });

  it("[positive][state-diff] persists Q2 chain dependencies and reconstructs the proof after delete/reparse", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-q2-call-resolution-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "q2-call-resolution",
      repoUrl: "file:///q2-call-resolution",
    }).id;
    const sources = [
      {
        file: "src/impl.ts",
        code: "export function work(): void {}",
      },
      {
        file: "src/barrel.ts",
        code: 'export { work as publicWork } from "./impl.js";',
      },
      {
        file: "src/caller.ts",
        code: [
          'import { publicWork as run } from "./barrel.js";',
          "export function caller(): void { run(); }",
        ].join("\n"),
      },
    ];
    const parsedResults: ParsedAstFileResult[] = [];
    for (const source of sources) {
      parsedResults.push(
        await parseAndWriteSource(tempDir, "q2-call-resolution", source),
      );
    }
    const persist = () =>
      new GraphPersisterService(new CallResolutionHypothesisService()).persist({
        store: store!,
        workspaceRoot: tempDir!,
        projectId,
        parsedResults,
        sourceIndexComplete: true,
        tags: [],
      });
    const caller = parsedResults.find(({ file }) => file === "src/caller.ts");
    if (!caller) throw new Error("Q2 caller parse result is missing");
    const callSite = caller.data.callSiteShapeFacts?.callSites.find(
      ({ calleeName }) => calleeName === "run",
    );
    if (!callSite)
      throw new Error("AST worker omitted the Q2 imported call site");

    await persist();
    const expectedKey = createPortableCallSiteKey({
      filePath: caller.file,
      sourceContentHash: caller.hash,
      startLine: callSite.startLine,
      startColumn: callSite.startColumn,
      calleeKind: callSite.calleeKind,
      calleeName: callSite.calleeName,
    });
    const dependencies = [
      {
        filePath: "src/barrel.ts",
        contentHash: createHash("sha256")
          .update(sources[1]!.code, "utf8")
          .digest("hex"),
      },
      { filePath: "src/caller.ts", contentHash: caller.hash },
      {
        filePath: "src/impl.ts",
        contentHash: createHash("sha256")
          .update(sources[0]!.code, "utf8")
          .digest("hex"),
      },
    ];
    const dependencyFingerprint = createHash("sha256")
      .update(JSON.stringify(dependencies), "utf8")
      .digest("hex");
    const getQ2Resolution = () =>
      store?.callSiteResolutions
        ?.getForFile(projectId, caller.file)
        .find(({ callSiteKey }) => callSiteKey === expectedKey);

    expect(getQ2Resolution()).toMatchObject({
      callSiteKey: expectedKey,
      resolutionClass: "proven",
      selectedTargetNodeKey: "src/impl.ts#work",
      ruleSignature: CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
      dependencies,
      dependencyFingerprint,
    });
    expect(projectedCallKeys()).toContainEqual({
      source: "src/caller.ts#caller",
      target: "src/impl.ts#work",
    });

    store.callSiteResolutions?.deleteForFile(projectId, caller.file);
    expect(getQ2Resolution()).toEqual(undefined);
    await persist();

    expect(getQ2Resolution()).toMatchObject({
      callSiteKey: expectedKey,
      selectedTargetNodeKey: "src/impl.ts#work",
      ruleSignature: CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
      dependencies,
      dependencyFingerprint,
    });
    expect(
      store.callSiteResolutions?.invalidateChangedDependencies(projectId, [
        {
          filePath: "src/barrel.ts",
          contentHash: "e".repeat(64),
        },
      ]),
    ).toBe(1);
    expect(getQ2Resolution()).toMatchObject({ isStale: true });
    expect(projectedCallKeys()).not.toContainEqual({
      source: "src/caller.ts#caller",
      target: "src/impl.ts#work",
    });
  });

  it("[positive][projection] keeps ScopeResolver callback attribution while storing the exact Q2 caller", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-q2-anonymous-caller-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "q2-anonymous-caller",
      repoUrl: "file:///q2-anonymous-caller",
    }).id;
    const sources = [
      {
        file: "src/impl.ts",
        code: "export function finish(): void {}",
      },
      {
        file: "src/barrel.ts",
        code: 'export { finish } from "./impl.js";',
      },
      {
        file: "src/caller.ts",
        code: [
          'import { finish } from "./barrel.js";',
          "export function handler(): void {",
          "  Promise.resolve().then(() => {",
          "    finish();",
          "  });",
          "}",
        ].join("\n"),
      },
    ];
    const parsedResults: ParsedAstFileResult[] = [];
    for (const source of sources) {
      parsedResults.push(
        await parseAndWriteSource(tempDir, "q2-anonymous-caller", source),
      );
    }

    await new GraphPersisterService(
      new CallResolutionHypothesisService(),
    ).persist({
      store,
      workspaceRoot: tempDir,
      projectId,
      parsedResults,
      sourceIndexComplete: true,
      tags: [],
    });

    const caller = parsedResults.find(({ file }) => file === "src/caller.ts");
    if (!caller) throw new Error("Q2 callback caller parse result is missing");
    const callSite = caller.data.callSiteShapeFacts?.callSites.find(
      ({ calleeName }) => calleeName === "finish",
    );
    if (!callSite)
      throw new Error("AST worker omitted the Q2 callback call site");
    const callSiteKey = createPortableCallSiteKey({
      filePath: caller.file,
      sourceContentHash: caller.hash,
      startLine: callSite.startLine,
      startColumn: callSite.startColumn,
      calleeKind: callSite.calleeKind,
      calleeName: callSite.calleeName,
    });
    const resolution = store.callSiteResolutions
      ?.getForFile(projectId, caller.file)
      .find(({ callSiteKey: key }) => key === callSiteKey);

    expect(resolution).toMatchObject({
      callSiteKey,
      callerNodeKey: "src/caller.ts#anonymous",
      selectedTargetNodeKey: "src/impl.ts#finish",
      ruleSignature: CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
    });
    expect(projectedCallKeys()).toEqual([
      {
        source: "src/caller.ts",
        target: "src/impl.ts#finish",
      },
    ]);
  });

  it("[positive][projection] keeps ScopeResolver callback attribution while storing the exact Q1 caller", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-q1-anonymous-caller-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "q1-anonymous-caller",
      repoUrl: "file:///q1-anonymous-caller",
    }).id;
    const sources = [
      {
        file: "src/implementation.ts",
        code: "export function finish(): void {}",
      },
      {
        file: "src/caller.ts",
        code: [
          'import { finish } from "./implementation.js";',
          "export function handler(): void {",
          "  Promise.resolve().then(() => {",
          "    finish();",
          "  });",
          "}",
        ].join("\n"),
      },
    ];
    const parsedResults: ParsedAstFileResult[] = [];
    for (const source of sources) {
      parsedResults.push(
        await parseAndWriteSource(tempDir, "q1-anonymous-caller", source),
      );
    }

    await new GraphPersisterService(
      new CallResolutionHypothesisService(),
    ).persist({
      store,
      workspaceRoot: tempDir,
      projectId,
      parsedResults,
      sourceIndexComplete: true,
      tags: [],
    });

    const caller = parsedResults.find(({ file }) => file === "src/caller.ts");
    if (!caller) throw new Error("caller parse result is missing");
    const callSite = caller.data.callSiteShapeFacts?.callSites.find(
      ({ calleeName }) => calleeName === "finish",
    );
    if (!callSite) throw new Error("AST worker omitted the imported call site");
    const enclosingFunctions = (caller.data.functions ?? []).filter(
      ({ startLine, endLine }) =>
        startLine <= callSite.startLine && endLine >= callSite.startLine,
    );
    const smallestFunctionSpan = Math.min(
      ...enclosingFunctions.map(
        ({ startLine, endLine }) => endLine - startLine,
      ),
    );
    const [enclosingCaller] = enclosingFunctions.filter(
      ({ startLine, endLine }) => endLine - startLine === smallestFunctionSpan,
    );
    expect(enclosingFunctions.length).toBeGreaterThan(0);
    expect(enclosingCaller?.name).toBe("anonymous");
    expect(
      enclosingFunctions.filter(
        ({ startLine, endLine }) =>
          endLine - startLine === smallestFunctionSpan,
      ),
    ).toHaveLength(1);
    const callSiteKey = createPortableCallSiteKey({
      filePath: caller.file,
      sourceContentHash: caller.hash,
      startLine: callSite.startLine,
      startColumn: callSite.startColumn,
      calleeKind: callSite.calleeKind,
      calleeName: callSite.calleeName,
    });
    const resolution = store.callSiteResolutions
      ?.getForFile(projectId, caller.file)
      .find(({ callSiteKey: key }) => key === callSiteKey);

    expect(resolution).toMatchObject({
      callSiteKey,
      callerNodeKey: `src/caller.ts#${enclosingCaller?.name}`,
      selectedTargetNodeKey: "src/implementation.ts#finish",
      ruleSignature: "q1:named-import:v1",
    });
    expect(projectedCallKeys()).toContainEqual({
      source: "src/caller.ts",
      target: "src/implementation.ts#finish",
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
