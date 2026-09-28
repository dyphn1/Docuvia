import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "@workspace/schema";
import {
  BlastRadiusEdgeSources,
  DynamicDependencyStatuses,
  DynamicEvidenceAvailabilityStates,
  DynamicEvidenceUnavailableReasons,
  type ParsedAstFileResult,
} from "@workspace/contracts";
import { GraphPersisterService } from "../graph/phase393-graph-persister.js";
import { ImpactService } from "./phase393-impact.service.js";
import {
  readDynamicDependencyEvidence,
  readDynamicDependencyEvidenceState,
} from "./dynamic-dependency-evidence.js";

// TDD-SOURCE: https://github.com/dyphn1/Docuvia/issues/393
// TDD-SOURCE: issue #508 Phase 2 (D1 corrupt evidence, D2 stale universe, D3 NodeNext specifiers)
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md

describe("issue #393 dynamic dependency evidence", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  let persister: GraphPersisterService;
  let impact: ImpactService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-dynamic-impact-"));
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
    projectId = store.projects.insert({
      name: "dynamic-impact",
      repoUrl: "file:///dynamic-impact",
    }).id;
    persister = new GraphPersisterService();
    impact = new ImpactService();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relativePath: string, content: string): void {
    const absolute = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }

  function trackFiles(filePaths: string[]): void {
    for (const filePath of filePaths) {
      store.files.upsertFile({
        projectId,
        filePath,
        contentHash: `tracked:${filePath}`,
      });
    }
  }

  function replaceWithDirectory(relativePath: string): void {
    const absolute = path.join(tmpDir, relativePath);
    fs.rmSync(absolute, { recursive: true, force: true });
    fs.mkdirSync(absolute, { recursive: true });
  }

  function restoreFile(relativePath: string, content: string): void {
    fs.rmSync(path.join(tmpDir, relativePath), {
      recursive: true,
      force: true,
    });
    write(relativePath, content);
  }

  function parsed(
    file: string,
    data: Partial<ParsedAstFileResult["data"]> = {},
  ): ParsedAstFileResult {
    return {
      file,
      hash: `hash:${file}`,
      language: "typescript",
      data: {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
        ...data,
      },
    };
  }

  function dynamicCandidates(target: string) {
    return (
      impact
        .getBlastRadius(store, target)
        ?.filter(
          (entry) =>
            entry.edgeSource === BlastRadiusEdgeSources.DYNAMIC_CANDIDATE,
        ) ?? []
    );
  }

  it("[happy] persists bounded template-import candidates deterministically without confirmed graph edges", async () => {
    const targetFile = "src/plugins/cleanup-plugin.ts";
    const sourceFile = "src/plugin-loader.ts";
    write(
      targetFile,
      'export function runCleanupPlugin() { return "cleaned"; }\n',
    );
    write(
      sourceFile,
      [
        "export async function loadPlugin(pluginName: string) {",
        "  return import(`./plugins/${pluginName}`);",
        "}",
        "",
      ].join("\n"),
    );

    const results = [
      parsed(targetFile, {
        functions: [{ name: "runCleanupPlugin", startLine: 0, endLine: 0 }],
      }),
      parsed(sourceFile, {
        functions: [{ name: "loadPlugin", startLine: 0, endLine: 2 }],
      }),
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: results,
      tags: [],
    });
    const firstEvidence = readDynamicDependencyEvidence(store, projectId);
    const firstCandidates = dynamicCandidates("runCleanupPlugin");

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: results,
      tags: [],
    });
    const secondEvidence = readDynamicDependencyEvidence(store, projectId);
    const secondCandidates = dynamicCandidates("runCleanupPlugin");

    expect(firstEvidence).toEqual([
      expect.objectContaining({
        sourceFile,
        expression: "`./plugins/${pluginName}`",
        literalPrefix: "./plugins/",
        literalSuffix: "",
        status: DynamicDependencyStatuses.BOUNDED,
        candidatePaths: [targetFile],
        reason: "bounded-local-pattern",
      }),
    ]);
    expect(secondEvidence).toEqual(firstEvidence);
    expect(firstCandidates).toEqual([
      expect.objectContaining({
        name: sourceFile,
        type: "module",
        edgeSource: BlastRadiusEdgeSources.DYNAMIC_CANDIDATE,
        dynamicEvidence: firstEvidence[0],
      }),
    ]);
    expect(secondCandidates).toEqual(firstCandidates);

    const targetNode = store.graph.findNodeByName("runCleanupPlugin");
    if (!targetNode)
      throw new Error("Expected persisted runCleanupPlugin node");
    expect(
      store.graph
        .getIncomingRelations(targetNode.id)
        .filter(({ linkType }) => linkType !== "contains"),
    ).toEqual([]);
  });

  it("uses literal prefix and suffix to bound a computed import without guessing unrelated files", async () => {
    const targetFile = "src/locales/en-messages.ts";
    const otherFile = "src/locales/en-other.ts";
    const sourceFile = "src/i18n.ts";
    write(targetFile, "export const EVAL_EN_MESSAGES = {};\n");
    write(otherFile, "export const OTHER = {};\n");
    write(
      sourceFile,
      [
        "export async function loadMessages(lang: string) {",
        "  return import(`./locales/${lang}-messages`);",
        "}",
        "",
      ].join("\n"),
    );

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(targetFile, {
          variables: [{ name: "EVAL_EN_MESSAGES", startLine: 0, endLine: 0 }],
        }),
        parsed(otherFile, {
          variables: [{ name: "OTHER", startLine: 0, endLine: 0 }],
        }),
        parsed(sourceFile, {
          functions: [{ name: "loadMessages", startLine: 0, endLine: 2 }],
        }),
      ],
      tags: [],
    });

    const evidence = impact.getDynamicEvidence(store, "EVAL_EN_MESSAGES");
    expect(evidence).toEqual([
      expect.objectContaining({
        sourceFile,
        literalPrefix: "./locales/",
        literalSuffix: "-messages",
        candidatePaths: [targetFile],
        status: DynamicDependencyStatuses.BOUNDED,
      }),
    ]);
    expect(dynamicCandidates("OTHER")).toEqual([]);
  });

  it("[invalid-input] persists unbounded runtime expressions with provenance but never invents a dependent", async () => {
    const targetFile = "src/plugins/cleanup-plugin.ts";
    const sourceFile = "src/runtime-loader.ts";
    write(
      targetFile,
      'export function runCleanupPlugin() { return "cleaned"; }\n',
    );
    write(
      sourceFile,
      [
        "export async function loadRuntime(moduleName: string) {",
        "  return import(moduleName);",
        "}",
        "",
      ].join("\n"),
    );

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(targetFile, {
          functions: [{ name: "runCleanupPlugin", startLine: 0, endLine: 0 }],
        }),
        parsed(sourceFile, {
          functions: [{ name: "loadRuntime", startLine: 0, endLine: 2 }],
        }),
      ],
      tags: [],
    });

    expect(dynamicCandidates("runCleanupPlugin")).toEqual([]);
    expect(impact.getDynamicEvidence(store, "runCleanupPlugin")).toEqual([
      expect.objectContaining({
        sourceFile,
        expression: "moduleName",
        status: DynamicDependencyStatuses.UNRESOLVED,
        candidatePaths: [],
        reason: "unbounded-runtime-expression",
        startLine: 1,
      }),
    ]);
  });

  const evidenceKey = () => `impact.dynamic-dependencies.v1:${projectId}`;

  // #508 Phase 2 D1: this test used to assert `readDynamicDependencyEvidence(...) === []` for a
  // corrupted row -- that encoded the defect ("corrupt" silently read as "no runtime imports",
  // which the epistemic ladder then reported as an exact answer). Corruption is now an explicit
  // unavailable state that keeps every impact result lower-bound.
  it("[error-handling] reports corrupted persisted evidence as explicitly unavailable, never as an empty set (#508 D1)", () => {
    store.meta.set(evidenceKey(), "{not-json");

    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.CORRUPT_JSON,
    });
    expect(impact.getDynamicEvidenceAvailability(store)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.CORRUPT_JSON,
    });
  });

  it("[invalid-input] a non-array or shape-invalid evidence payload is unavailable and never throws (#508 D1)", async () => {
    const targetFile = "src/plugins/cleanup-plugin.ts";
    write(targetFile, 'export function runCleanupPlugin() { return "x"; }\n');
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(targetFile, {
          functions: [{ name: "runCleanupPlugin", startLine: 0, endLine: 0 }],
        }),
      ],
      tags: [],
    });

    store.meta.set(evidenceKey(), "{}");
    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.NOT_ARRAY,
    });

    // A record without `candidatePaths` used to crash `dynamicEvidenceForTarget` with a
    // TypeError (the CLI exited 1). One invalid record makes the whole set untrusted.
    store.meta.set(
      evidenceKey(),
      JSON.stringify([
        {
          sourceFile: "src/plugin-loader.ts",
          kind: "dynamic-import",
          expression: "x",
          startLine: 0,
          startColumn: 0,
          status: "bounded",
          reason: "x",
        },
      ]),
    );
    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.INVALID_RECORD,
    });
    expect(impact.getDynamicEvidence(store, "runCleanupPlugin")).toEqual([]);
    expect(impact.getBlastRadius(store, "runCleanupPlugin")).toEqual([
      expect.objectContaining({ name: targetFile }),
    ]);
  });

  it("[state-diff] a missing evidence row over tracked JS/TS sources is unavailable, and the next persist rebuilds every source (#508 D1/D5)", async () => {
    const loader = "src/plugin-loader.ts";
    const plugin = "src/plugins/alpha.ts";
    const other = "src/other.ts";
    writeTemplateLoader(loader);
    write(plugin, "export function alphaPlugin() {}\n");
    write(other, "export const other = 1;\n");
    // Tracked files whose evidence was never written -- the state a knowledge-branch hydrate
    // leaves behind (the evidence row is not part of the snapshot).
    for (const filePath of [loader, plugin]) {
      store.files.upsertFile({ projectId, filePath, contentHash: filePath });
    }
    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.MISSING,
    });

    // An incremental batch that does not include the loader must not launder the unavailable
    // set into an "available" partial one: every tracked source is rescanned.
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(other)],
      tags: [],
    });
    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.AVAILABLE,
      items: [
        expect.objectContaining({
          sourceFile: loader,
          status: DynamicDependencyStatuses.BOUNDED,
          candidatePaths: [plugin],
        }),
      ],
    });
  });

  it("[error-handling] an unreadable tracked loader keeps an incomplete heal unavailable (#508 D5)", async () => {
    const loader = "src/plugin-loader.ts";
    const plugin = "src/plugins/alpha.ts";
    const other = "src/other.ts";
    writeTemplateLoader(loader);
    write(plugin, "export function alphaPlugin() {}\n");
    write(other, "export const other = 1;\n");
    trackFiles([loader, plugin, other]);
    store.meta.set(evidenceKey(), "{not-json");
    replaceWithDirectory(loader);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(other)],
      tags: [],
    });

    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.INCOMPLETE_SCAN,
    });
  });

  it("[error-handling] a tracked source outside the workspace keeps the scan unavailable (#508 D5)", async () => {
    const outside = "../outside.ts";
    const other = "src/other.ts";
    write(other, "export const other = 1;\n");
    trackFiles([outside, other]);
    store.meta.set(evidenceKey(), "{not-json");

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(other)],
      tags: [],
    });

    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.INCOMPLETE_SCAN,
    });
  });

  it("[state-diff] heals incomplete evidence after the unreadable loader is restored (#508 D5)", async () => {
    const loader = "src/plugin-loader.ts";
    const plugin = "src/plugins/alpha.ts";
    const other = "src/other.ts";
    const loaderSource = [
      "export async function loadPlugin(pluginName: string) {",
      "  return import(`./plugins/${pluginName}`);",
      "}",
      "",
    ].join("\n");
    write(loader, loaderSource);
    write(plugin, "export function alphaPlugin() {}\n");
    write(other, "export const other = 1;\n");
    trackFiles([loader, plugin, other]);
    store.meta.set(evidenceKey(), "{not-json");
    replaceWithDirectory(loader);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(other)],
      tags: [],
    });
    restoreFile(loader, loaderSource);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(other)],
      tags: [],
    });

    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.AVAILABLE,
      items: [
        expect.objectContaining({
          sourceFile: loader,
          candidatePaths: [plugin],
        }),
      ],
    });
  });

  it("[happy] skips a deleted tracked source during an incomplete heal (#508 D5)", async () => {
    const loader = "src/plugin-loader.ts";
    const other = "src/other.ts";
    write(other, "export const other = 1;\n");
    trackFiles([loader, other]);
    store.meta.set(evidenceKey(), "{not-json");

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(other)],
      tags: [],
    });

    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.AVAILABLE,
      items: [],
    });
  });

  it("[error-handling] an unreadable reparsed source makes an ordinary incremental scan unavailable (#508 D5)", async () => {
    const loader = "src/plugin-loader.ts";
    const plugin = "src/plugins/alpha.ts";
    writeTemplateLoader(loader);
    write(plugin, "export function alphaPlugin() {}\n");

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(plugin), loaderParse(loader)],
      tags: [],
    });
    replaceWithDirectory(loader);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [loaderParse(loader)],
      tags: [],
    });

    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
      reason: DynamicEvidenceUnavailableReasons.INCOMPLETE_SCAN,
    });
  });

  it("[happy] a missing evidence row without any JS/TS source is simply empty evidence", () => {
    store.files.upsertFile({
      projectId,
      filePath: "src/app.py",
      contentHash: "py",
    });
    expect(readDynamicDependencyEvidenceState(store, projectId)).toEqual({
      state: DynamicEvidenceAvailabilityStates.AVAILABLE,
      items: [],
    });
    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([]);
  });

  it("[state-diff] replaces a stale bounded candidate when reparsing the source as unbounded", async () => {
    const targetFile = "src/plugins/cleanup-plugin.ts";
    const sourceFile = "src/plugin-loader.ts";
    write(
      targetFile,
      'export function runCleanupPlugin() { return "cleaned"; }\n',
    );
    write(
      sourceFile,
      [
        "export async function loadPlugin(pluginName: string) {",
        "  return import(`./plugins/${pluginName}`);",
        "}",
        "",
      ].join("\n"),
    );

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(targetFile, {
          functions: [{ name: "runCleanupPlugin", startLine: 0, endLine: 0 }],
        }),
        parsed(sourceFile, {
          functions: [{ name: "loadPlugin", startLine: 0, endLine: 2 }],
        }),
      ],
      tags: [],
    });
    expect(dynamicCandidates("runCleanupPlugin")).toEqual([
      expect.objectContaining({ name: sourceFile }),
    ]);

    write(
      sourceFile,
      [
        "export async function loadPlugin(moduleName: string) {",
        "  return import(moduleName);",
        "}",
        "",
      ].join("\n"),
    );
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(sourceFile, {
          functions: [{ name: "loadPlugin", startLine: 0, endLine: 2 }],
        }),
      ],
      tags: [],
    });

    expect(dynamicCandidates("runCleanupPlugin")).toEqual([]);
    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([
      expect.objectContaining({
        sourceFile,
        expression: "moduleName",
        status: DynamicDependencyStatuses.UNRESOLVED,
        candidatePaths: [],
        reason: "unbounded-runtime-expression",
      }),
    ]);
  });

  it("[stress] keeps the maximum 64-candidate local pattern bounded and deterministic", async () => {
    const sourceFile = "src/plugin-loader.ts";
    const candidateFiles = Array.from(
      { length: 64 },
      (_, index) => `src/plugins/plugin-${String(index).padStart(2, "0")}.ts`,
    );
    for (const candidateFile of candidateFiles) {
      write(
        candidateFile,
        `export const plugin = ${JSON.stringify(candidateFile)};\n`,
      );
    }
    write(
      sourceFile,
      [
        "export async function loadPlugin(pluginName: string) {",
        "  return import(`./plugins/${pluginName}`);",
        "}",
        "",
      ].join("\n"),
    );

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        ...candidateFiles.map((file) => parsed(file)),
        parsed(sourceFile, {
          functions: [{ name: "loadPlugin", startLine: 0, endLine: 2 }],
        }),
      ],
      tags: [],
    });

    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([
      expect.objectContaining({
        sourceFile,
        status: DynamicDependencyStatuses.BOUNDED,
        candidatePaths: candidateFiles,
        reason: "bounded-local-pattern",
      }),
    ]);
  });

  function writePluginFamily(dir: string, count: number): string[] {
    const files = Array.from(
      { length: count },
      (_, index) => `${dir}/plugin-${String(index).padStart(2, "0")}.ts`,
    );
    for (const file of files) {
      write(file, `export const plugin = ${JSON.stringify(file)};\n`);
    }
    return files;
  }

  function writeTemplateLoader(sourceFile: string, suffix = ""): void {
    write(
      sourceFile,
      [
        "export async function loadPlugin(pluginName: string) {",
        `  return import(\`./plugins/\${pluginName}${suffix}\`);`,
        "}",
        "",
      ].join("\n"),
    );
  }

  const loaderParse = (sourceFile: string) =>
    parsed(sourceFile, {
      functions: [{ name: "loadPlugin", startLine: 0, endLine: 2 }],
    });

  it("[stress] sends a 65-candidate local pattern down the overflow path, never a truncated bounded set", async () => {
    const sourceFile = "src/plugin-loader.ts";
    const candidateFiles = writePluginFamily("src/plugins", 65);
    writeTemplateLoader(sourceFile);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        ...candidateFiles.map((file) => parsed(file)),
        loaderParse(sourceFile),
      ],
      tags: [],
    });

    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([
      expect.objectContaining({
        sourceFile,
        status: DynamicDependencyStatuses.UNRESOLVED,
        candidatePaths: [],
        reason: "candidate-set-exceeds-64",
      }),
    ]);
  });

  it("[state-diff] re-resolves retained evidence when a candidate joins without the loader being re-parsed (#508 D2)", async () => {
    const sourceFile = "src/plugin-loader.ts";
    const alpha = "src/plugins/alpha.ts";
    const gamma = "src/plugins/gamma.ts";
    write(alpha, "export function alphaPlugin() {}\n");
    writeTemplateLoader(sourceFile);
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(alpha, {
          functions: [{ name: "alphaPlugin", startLine: 0, endLine: 0 }],
        }),
        loaderParse(sourceFile),
      ],
      tags: [],
    });

    write(gamma, "export function gammaPlugin() {}\n");
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(gamma, {
          functions: [{ name: "gammaPlugin", startLine: 0, endLine: 0 }],
        }),
      ],
      tags: [],
    });

    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([
      expect.objectContaining({
        sourceFile,
        status: DynamicDependencyStatuses.BOUNDED,
        candidatePaths: [alpha, gamma],
      }),
    ]);
    expect(dynamicCandidates("gammaPlugin")).toEqual([
      expect.objectContaining({ name: sourceFile }),
    ]);
  });

  it("[state-diff] incremental growth from 64 to 65 candidates moves retained evidence to overflow (#508 D2)", async () => {
    const sourceFile = "src/plugin-loader.ts";
    const initial = writePluginFamily("src/plugins", 64);
    writeTemplateLoader(sourceFile);
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        ...initial.map((file) => parsed(file)),
        loaderParse(sourceFile),
      ],
      tags: [],
    });
    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([
      expect.objectContaining({ candidatePaths: initial }),
    ]);

    const extra = "src/plugins/plugin-64.ts";
    write(extra, "export const plugin = 64;\n");
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [parsed(extra)],
      tags: [],
    });

    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([
      expect.objectContaining({
        sourceFile,
        status: DynamicDependencyStatuses.UNRESOLVED,
        candidatePaths: [],
        reason: "candidate-set-exceeds-64",
      }),
    ]);
  });

  it("[happy] binds NodeNext `.js` template and literal specifiers to .ts sources (#508 D3)", async () => {
    const templateLoader = "src/plugin-loader.ts";
    const literalLoader = "src/literal-loader.ts";
    const target = "src/plugins/one.ts";
    const mjsTarget = "src/plugins/two.mts";
    write(target, "export function onePlugin() {}\n");
    write(mjsTarget, "export function twoPlugin() {}\n");
    writeTemplateLoader(templateLoader, ".js");
    write(
      literalLoader,
      [
        "export async function loadTwo() {",
        '  return import("./plugins/two.mjs");',
        "}",
        "",
      ].join("\n"),
    );

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: [
        parsed(target, {
          functions: [{ name: "onePlugin", startLine: 0, endLine: 0 }],
        }),
        parsed(mjsTarget, {
          functions: [{ name: "twoPlugin", startLine: 0, endLine: 0 }],
        }),
        loaderParse(templateLoader),
        parsed(literalLoader, {
          functions: [{ name: "loadTwo", startLine: 0, endLine: 2 }],
        }),
      ],
      tags: [],
    });

    expect(readDynamicDependencyEvidence(store, projectId)).toEqual([
      expect.objectContaining({
        sourceFile: literalLoader,
        status: DynamicDependencyStatuses.BOUNDED,
        candidatePaths: [mjsTarget],
        reason: "literal-dynamic-import",
      }),
      expect.objectContaining({
        sourceFile: templateLoader,
        status: DynamicDependencyStatuses.BOUNDED,
        // `.js` is the runtime spelling of .ts/.tsx/.js/.jsx only -- never of .mts.
        candidatePaths: [target],
        reason: "bounded-local-pattern",
      }),
    ]);
    expect(dynamicCandidates("onePlugin")).toEqual([
      expect.objectContaining({ name: templateLoader }),
    ]);
  });
});
