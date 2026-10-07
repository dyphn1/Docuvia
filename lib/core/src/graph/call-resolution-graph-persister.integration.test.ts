import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX,
  CallsProjectionCallerPolicies,
  CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
  createPortableCallSiteKey,
  LinkTypes,
  type CallsProjectionCallerPolicy,
  type ParsedAstFileResult,
} from "@workspace/contracts";
import { GraphStore } from "@workspace/schema";
import { CallResolutionHypothesisService } from "../semantic/call-resolution-hypothesis.service.js";
import { buildParseResponse } from "../ast/ast-worker.js";
import { GraphPersisterService } from "./phase393-graph-persister.js";

describe("GraphPersister call-resolution integration", () => {
  const callbackOwnerSource = [
    "export class Owner {",
    "  field = () => { return 1; };",
    "  method(): void {",
    "    [1].map(() => 1);",
    "  }",
    "}",
  ].join("\n");
  const defaultPolicySource = [
    "function localTarget(): void {}",
    "export function outer(): void {",
    "  [1].map((value) => {",
    "    localTarget();",
    "    return value;",
    "  });",
    "}",
  ].join("\n");

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

  async function persistSourceWithPolicy(
    code: string,
    sourceIndexComplete = true,
    callerPolicy?: CallsProjectionCallerPolicy,
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

    const persister =
      callerPolicy === undefined
        ? new GraphPersisterService(new CallResolutionHypothesisService())
        : new GraphPersisterService(
            new CallResolutionHypothesisService(),
            callerPolicy,
          );
    await persister.persist({
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

  async function persistSource(
    code: string,
    sourceIndexComplete = true,
  ): ReturnType<typeof persistSourceWithPolicy> {
    return persistSourceWithPolicy(
      code,
      sourceIndexComplete,
      CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
    );
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

  it("[regression][default-policy] constructs the persister with exact-v2 caller and lexical projections", async () => {
    const { projectId, filePath } =
      await persistSourceWithPolicy(defaultPolicySource);
    if (!store) throw new Error("GraphStore was not initialized");

    expect(
      store.meta.get(
        `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
      ),
    ).toBe(CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2);
    const callbackNode = store.graph
      .getAllNodes()
      .find((node) => node.node_key?.startsWith(`${filePath}#anonymous`));
    expect(callbackNode?.node_key).toBe(`${filePath}#anonymous`);
    expect(projectedCallKeys()).toContainEqual({
      source: callbackNode?.node_key,
      target: `${filePath}#localTarget`,
    });
    expect(store.graph.getIncomingRelations(callbackNode!.id)).toContainEqual(
      expect.objectContaining({
        name: "outer",
        linkType: LinkTypes.LEXICAL_PARENT,
      }),
    );
  });

  it("[regression][exact-v1] does not persist v2 lexical links", async () => {
    const { projectId } = await persistSourceWithPolicy(
      callbackOwnerSource,
      true,
      CallsProjectionCallerPolicies.EXACT_ENCLOSING_V1,
    );
    if (!store) throw new Error("GraphStore was not initialized");

    expect(
      store.meta.get(
        `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
      ),
    ).toBe(CallsProjectionCallerPolicies.EXACT_ENCLOSING_V1);
    expect(
      store.graph
        .getAllLinks()
        .map(({ link_type }) => link_type)
        .filter(
          (linkType) =>
            linkType === LinkTypes.LEXICAL_PARENT ||
            linkType === LinkTypes.LEXICAL_OWNER,
        ),
    ).toEqual([]);
  });

  it("[regression][exact-v2] persists file ownership separately from function and class lexical context", async () => {
    const { projectId, filePath } = await persistSource(callbackOwnerSource);
    if (!store) throw new Error("GraphStore was not initialized");
    const nodes = store.graph.getAllNodes();
    const owner = nodes.find((node) => node.node_key === `${filePath}#Owner`);
    const method = nodes.find((node) => node.name === "method");
    const links = store.graph.getAllLinks();
    expect(owner?.node_key).toBe(`${filePath}#Owner`);
    expect(method?.name).toBe("method");
    expect(
      links.some(
        (link) =>
          link.source_node_id === owner?.id &&
          link.link_type === LinkTypes.LEXICAL_OWNER,
      ),
    ).toBe(true);
    expect(
      links.some(
        (link) =>
          link.source_node_id === method?.id &&
          link.link_type === LinkTypes.LEXICAL_PARENT,
      ),
    ).toBe(true);
    const lexicalTargets = links
      .filter(
        ({ link_type }) =>
          link_type === LinkTypes.LEXICAL_PARENT ||
          link_type === LinkTypes.LEXICAL_OWNER,
      )
      .map(({ target_node_id }) => target_node_id);
    for (const nodeId of new Set(lexicalTargets)) {
      expect(
        store.graph
          .getIncomingRelations(nodeId)
          .filter((relation) => relation.linkType === LinkTypes.CONTAINS)
          .map((relation) => relation.name),
      ).toEqual([filePath]);
    }
    expect(
      store.meta.get(
        `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
      ),
    ).toBe(CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2);
  });

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
    ).toEqual({
      invalidatedCount: 1,
      affectedFilePaths: [caller.file],
    });
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
    ).toEqual({
      invalidatedCount: 1,
      affectedFilePaths: [caller.file],
    });
    expect(getQ2Resolution()).toMatchObject({ isStale: true });
    expect(projectedCallKeys()).not.toContainEqual({
      source: "src/caller.ts#caller",
      target: "src/impl.ts#work",
    });
  });

  it("[positive][projection] uses the exact callback caller for Q2 edges and records", async () => {
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
      CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
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
        source: "src/caller.ts#anonymous",
        target: "src/impl.ts#finish",
      },
    ]);
  });

  it("[positive][projection] uses the exact callback caller for Q1 edges and records", async () => {
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
      CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
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
      source: "src/caller.ts#anonymous",
      target: "src/implementation.ts#finish",
    });
  });

  it("[happy][boundary][persistence] persists a proven import when AST target and caller nodes are ambiguous", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-q1-ambiguous-nodes-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "q1-ambiguous-nodes",
      repoUrl: "file:///q1-ambiguous-nodes",
    }).id;
    const sources = [
      {
        file: "src/implementation.ts",
        code: [
          "const callbacks = { finish(): void {} };",
          "export function finish(): void {}",
        ].join("\n"),
      },
      {
        file: "src/caller.ts",
        code: [
          'import { finish } from "./implementation.js";',
          "export function call(): void { Promise.resolve().then(() => Promise.resolve().then(() => finish())); }",
        ].join("\n"),
      },
    ];
    const parsedResults = await Promise.all(
      sources.map((source) =>
        parseAndWriteSource(tempDir!, "q1-ambiguous-nodes", source),
      ),
    );
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
      callerNodeKey: "src/caller.ts",
      selectedTargetNodeKey: "src/implementation.ts#finish@L1",
      ruleSignature: "q1:named-import:v1",
    });
    expect(projectedCallKeys()).toContainEqual({
      source: "src/caller.ts",
      target: "src/implementation.ts#finish@L1",
    });
  });

  it("[invalid-input][error-handling][state-diff] applies exact caller policy when the source index is incomplete", async () => {
    const code =
      "class Service { close(): void {} call(): void { this.close(); } }";
    const { filePath, projectId } = await persistSource(code, false);

    expect(store?.callSiteResolutions?.getForFile(projectId, filePath)).toEqual(
      [],
    );
    expect(projectedCallKeys()).toContainEqual({
      source: filePath,
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

  it("[happy][state-diff] proves an explicitly class-typed parameter receiver", async () => {
    const code =
      "class Service { close(): void {} call(other: Service): void { other.close(); } }";
    const { filePath, projectId, sourceContentHash } =
      await persistSource(code);

    const resolutions = store?.callSiteResolutions?.getForFile(
      projectId,
      filePath,
    );
    expect(
      resolutions?.map(
        ({
          resolutionClass,
          ruleSignature,
          selectedTargetNodeKey,
          callerNodeKey,
          dependencies,
        }) => ({
          resolutionClass,
          ruleSignature,
          selectedTargetNodeKey,
          callerNodeKey,
          dependencies: dependencies.map(({ filePath: dependencyPath }) => ({
            filePath: dependencyPath,
            contentHash: sourceContentHash,
          })),
        }),
      ),
    ).toEqual([
      {
        resolutionClass: "proven",
        ruleSignature: "q3:typed-receiver:v1",
        selectedTargetNodeKey: `${filePath}#Service.close`,
        callerNodeKey: filePath,
        dependencies: [{ filePath, contentHash: sourceContentHash }],
      },
    ]);
    expect(projectedCallKeys()).toContainEqual({
      source: filePath,
      target: `${filePath}#Service.close`,
    });
  });

  it("[regression][exact-v2] keeps legacy caller context for a strict-proof call", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-exact-proof-caller-context-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "exact-proof-caller-context",
      repoUrl: "file:///exact-proof-caller-context",
    }).id;
    const sources = [
      {
        file: "src/provider.ts",
        code: "export class Provider { close(): void {} }",
      },
      {
        file: "src/caller.ts",
        code: [
          'import { Provider } from "./provider.js";',
          "function legacyCaller(): void {}",
          "function run(): void { const provider = new Provider(); provider.close(); }",
        ].join("\n"),
      },
    ];
    const parsedResults = await Promise.all(
      sources.map((source) =>
        parseAndWriteSource(tempDir!, "exact-proof-candidate", source),
      ),
    );
    const callerResult = parsedResults.find(
      ({ file }) => file === "src/caller.ts",
    );
    if (!callerResult) throw new Error("Caller source was not parsed");
    const modifiedResults = parsedResults.map((result) =>
      result.file === callerResult.file
        ? {
            ...result,
            data: {
              ...result.data,
              calls: result.data.calls?.map((call) =>
                call.calleeName === "close"
                  ? { ...call, sourceFunction: "legacyCaller" }
                  : call,
              ),
            },
          }
        : result,
    );
    await new GraphPersisterService(
      new CallResolutionHypothesisService(),
      CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
    ).persist({
      store,
      workspaceRoot: tempDir,
      projectId,
      parsedResults: modifiedResults,
      sourceIndexComplete: true,
      tags: [],
    });
    const targetKey = "src/provider.ts#Provider.close";
    const candidateId = store.graph.findNodeIdByNodeKey(
      "src/caller.ts#legacyCaller",
    );
    const targetId = store.graph.findNodeIdByNodeKey(targetKey);

    expect(
      store.callSiteResolutions?.getForFile(projectId, "src/caller.ts"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleSignature: "q3:new-receiver:v1",
          selectedTargetNodeKey: targetKey,
          callerNodeKey: "src/caller.ts#run",
        }),
      ]),
    );
    expect(
      store.graph
        .getIncomingRelations(targetId!)
        .filter(({ linkType }) => linkType === LinkTypes.CALLER_CANDIDATE),
    ).toContainEqual(
      expect.objectContaining({
        id: candidateId,
        linkType: LinkTypes.CALLER_CANDIDATE,
      }),
    );
  });

  it("[invalid-input][error-handling][state-diff] abstains for an interface-typed receiver and keeps the legacy edge", async () => {
    const code = [
      "interface Service { close(): void }",
      "class Client { close(): void {} call(other: Service): void { other.close(); } }",
    ].join("\n");
    const { filePath, projectId } = await persistSource(code);

    expect(store?.callSiteResolutions?.getForFile(projectId, filePath)).toEqual(
      [],
    );
    expect(projectedCallKeys()).toContainEqual({
      source: filePath,
      target: `${filePath}#Client.close`,
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
        CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
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

  it("[happy][stress][state-diff] uses one exact callback caller for proven and unproven calls", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-exact-caller-policy-"),
    );
    store = await GraphStore.open({
      dbPath: path.join(tempDir, ".docuvia", "local.db"),
    });
    const projectId = store.projects.insert({
      name: "exact-caller-policy",
      repoUrl: "file:///exact-caller-policy",
    }).id;
    const sources = [
      {
        file: "src/target.ts",
        code: "export function importedTarget(): void {}\n",
      },
      {
        file: "src/caller.ts",
        code: [
          'import { importedTarget } from "./target.js";',
          "function localTarget(): void {}",
          "export function outer(): void {",
          "  [1].map((value) => {",
          "    localTarget();",
          "    importedTarget();",
          "    return value;",
          "  });",
          "}",
        ].join("\n"),
      },
    ];
    const parsedResults = await Promise.all(
      sources.map((source) =>
        parseAndWriteSource(tempDir!, "exact-caller-policy", source),
      ),
    );
    const persist = () =>
      new GraphPersisterService(
        new CallResolutionHypothesisService(),
        CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
      ).persist({
        store: store!,
        workspaceRoot: tempDir!,
        projectId,
        parsedResults,
        sourceIndexComplete: true,
        tags: [],
      });

    await persist();
    const callerResult = parsedResults.find(
      (result) => result.file === "src/caller.ts",
    );
    if (!callerResult) throw new Error("Caller source was not parsed");
    const callbackNode = store.graph
      .getAllNodes()
      .find(
        (node) => node.node_key?.startsWith("src/caller.ts#anonymous") === true,
      );
    expect(callbackNode?.node_key).toMatch(/^src\/caller\.ts#anonymous/);
    expect(store.graph.getIncomingRelations(callbackNode!.id)).toContainEqual(
      expect.objectContaining({
        name: "outer",
        linkType: LinkTypes.LEXICAL_PARENT,
      }),
    );
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
    expect(calls).toContainEqual({
      source: callbackNode?.node_key,
      target: "src/caller.ts#localTarget",
    });
    expect(calls).toContainEqual({
      source: callbackNode?.node_key,
      target: "src/target.ts#importedTarget",
    });
    const resolutions = store.callSiteResolutions?.getForFile(
      projectId,
      callerResult.file,
    );
    expect(
      resolutions?.find((row) => row.calleeName === "importedTarget"),
    ).toMatchObject({
      resolutionClass: "proven",
      callerNodeKey: callbackNode?.node_key,
    });
    expect(
      store.meta.get(
        `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
      ),
    ).toBe(CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2);

    const stableCalls = calls;
    await persist();
    const repeatedNodeKeyById = new Map(
      store.graph
        .getAllNodes()
        .map((node) => [node.id, node.node_key] as const),
    );
    const repeatedCalls = store.graph
      .getAllLinks()
      .filter((link) => link.link_type === "calls")
      .map((link) => ({
        source: repeatedNodeKeyById.get(link.source_node_id),
        target: repeatedNodeKeyById.get(link.target_node_id),
      }));
    expect(repeatedCalls).toEqual(stableCalls);
  });
});
