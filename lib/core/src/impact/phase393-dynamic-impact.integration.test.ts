import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "@workspace/schema";
import {
  BlastRadiusEdgeSources,
  DynamicDependencyStatuses,
  type ParsedAstFileResult,
} from "@workspace/contracts";
import { GraphPersisterService } from "../graph/phase393-graph-persister.js";
import { ImpactService } from "./phase393-impact.service.js";
import { readDynamicDependencyEvidence } from "./dynamic-dependency-evidence.js";

// TDD-SOURCE: https://github.com/dyphn1/Docuvia/issues/393

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

  it("persists bounded template-import candidates deterministically without confirmed graph edges", async () => {
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
    expect(targetNode).toBeDefined();
    expect(
      store.graph
        .getIncomingRelations(targetNode!.id)
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

  it("persists unbounded runtime expressions with provenance but never invents a dependent", async () => {
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
});
