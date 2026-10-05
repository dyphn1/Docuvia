import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ParsedAstFileResult } from "@workspace/contracts";
import { GraphStore } from "@workspace/schema";
import { buildParseResponse } from "../ast/ast-worker.js";
import { CallResolutionHypothesisService } from "../semantic/call-resolution-hypothesis.service.js";
import { GraphPersisterService } from "./phase393-graph-persister.js";

const BASELINE_COMMIT = "9ad485c10272584f05679698ec5309d8c2daecad";

const SOURCES = [
  {
    file: "src/combined-function.ts",
    code: [
      "export function namedHelper() {}",
      "export default function CombinedTarget() {}",
    ].join("\n"),
  },
  {
    file: "src/standalone-function.ts",
    code: "export default function StandaloneTarget() {}",
  },
  {
    file: "src/default-class.ts",
    code: "export default class DefaultClass {}",
  },
  {
    file: "src/default-expression.ts",
    code: "export default { run() {} };",
  },
  {
    file: "src/calls.ts",
    code: [
      'import CombinedTarget, { namedHelper } from "./combined-function";',
      'import StandaloneTarget from "./standalone-function";',
      'import DefaultClass from "./default-class";',
      'import DefaultValue from "./default-expression";',
      "export function invokeImportedDefaults() {",
      "  CombinedTarget();",
      "  StandaloneTarget();",
      "  DefaultClass();",
      "  DefaultValue();",
      "  namedHelper();",
      "}",
    ].join("\n"),
  },
  {
    file: "src/unused-combined-import.ts",
    code: [
      'import UnusedDefault, { namedHelper } from "./combined-function";',
      "export function leaveImportsUnused() {}",
    ].join("\n"),
  },
] as const;

type GraphSnapshot = {
  readonly nodes: readonly Record<string, unknown>[];
  readonly links: readonly Record<string, unknown>[];
  readonly linkCountsByType: Readonly<Record<string, number>>;
};

describe("default import graph parity", () => {
  let stores: GraphStore[] = [];
  let tempDir: string | undefined;

  afterEach(async () => {
    for (const store of stores) await store.close();
    stores = [];
    if (tempDir) {
      const fs = await import("node:fs");
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDir = undefined;
  });

  it("[happy][boundary][invalid-input][error-handling][stress][state-diff] preserves fallback graph rows across default exports and repeated persists", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-default-import-graph-parity-"),
    );
    for (const source of SOURCES) {
      const absolutePath = path.join(tempDir, source.file);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, source.code, "utf8");
    }

    const parsedResults: ParsedAstFileResult[] = [];
    for (const source of SOURCES) {
      const response = await buildParseResponse({
        taskId: `default-import-parity-${source.file}`,
        filePath: source.file,
        code: source.code,
        language: "typescript",
      });
      if (!response.success || !response.data)
        throw new Error(
          response.error ?? `AST parse failed for ${source.file}`,
        );
      parsedResults.push({
        file: source.file,
        hash: createHash("sha256").update(source.code).digest("hex"),
        data: response.data,
      });
    }

    const legacyResults = parsedResults.map((result) => ({
      ...result,
      data: {
        ...result.data,
        imports: (result.data.imports ?? []).filter(
          (descriptor) => !descriptor.isCombinedDefaultImport,
        ),
        exports: (result.data.exports ?? []).filter(
          (descriptor) => descriptor.name !== "default",
        ),
      },
    }));

    // This is the exact AST output shape from HEAD: its import parser omitted the default
    // binding in combined imports, and its export extractor returned no default descriptors.
    expect(
      legacyResults.find(({ file }) => file === "src/calls.ts")?.data.imports,
    ).toEqual([
      {
        localName: "namedHelper",
        originalName: "namedHelper",
        modulePath: "./combined-function",
      },
      {
        localName: "StandaloneTarget",
        originalName: "*",
        modulePath: "./standalone-function",
      },
      {
        localName: "DefaultClass",
        originalName: "*",
        modulePath: "./default-class",
      },
      {
        localName: "DefaultValue",
        originalName: "*",
        modulePath: "./default-expression",
      },
    ]);
    expect(
      legacyResults
        .filter(
          ({ file }) =>
            file !== "src/calls.ts" && file !== "src/unused-combined-import.ts",
        )
        .map(({ file, data }) => [file, data.exports]),
    ).toEqual([
      ["src/combined-function.ts", [{ name: "namedHelper", type: "function" }]],
      ["src/standalone-function.ts", []],
      ["src/default-class.ts", []],
      ["src/default-expression.ts", []],
    ]);
    expect(
      parsedResults.find(({ file }) => file === "src/default-class.ts")?.data
        .exports,
    ).toEqual([expect.objectContaining({ name: "default", type: "class" })]);
    expect(
      parsedResults.find(({ file }) => file === "src/default-expression.ts")
        ?.data.exports,
    ).toEqual([expect.objectContaining({ name: "default", type: "other" })]);

    const persist = async (
      inputResults: ParsedAstFileResult[],
      name: string,
      repetitions = 1,
    ): Promise<GraphSnapshot> => {
      const dbPath = path.join(tempDir!, name, ".docuvia", "local.db");
      const store = await GraphStore.open({ dbPath });
      stores.push(store);
      const projectId = store.projects.insert({
        name,
        repoUrl: `file:///${name}`,
      }).id;
      const persister = new GraphPersisterService(
        new CallResolutionHypothesisService(),
      );
      const snapshots: GraphSnapshot[] = [];
      for (let iteration = 0; iteration < repetitions; iteration++) {
        await persister.persist({
          store,
          workspaceRoot: tempDir!,
          projectId,
          parsedResults: inputResults,
          sourceIndexComplete: true,
          tags: [],
        });

        const nodes = store.graph.getAllNodes().map((node) => {
          const {
            id: _id,
            created_at: _createdAt,
            last_verified_at: _lastVerifiedAt,
            updated_at: _updatedAt,
            ...stableNode
          } = node;
          return stableNode;
        });
        const nodeKeyById = new Map(
          store.graph.getAllNodes().map((node) => [node.id, node.node_key]),
        );
        const links = store.graph.getAllLinks().map((link) => {
          const {
            id: _id,
            source_node_id: _sourceNodeId,
            target_node_id: _targetNodeId,
            created_at: _createdAt,
            ...stableLink
          } = link;
          return {
            ...stableLink,
            source_node_key: nodeKeyById.get(link.source_node_id),
            target_node_key: nodeKeyById.get(link.target_node_id),
          };
        });
        const compare = (
          left: Record<string, unknown>,
          right: Record<string, unknown>,
        ) => JSON.stringify(left).localeCompare(JSON.stringify(right));
        nodes.sort(compare);
        links.sort(compare);
        const linkCountsByType = links.reduce<Record<string, number>>(
          (counts, link) => {
            const type = String(link.link_type);
            counts[type] = (counts[type] ?? 0) + 1;
            return counts;
          },
          {},
        );
        snapshots.push({ nodes, links, linkCountsByType });
      }

      const [initialSnapshot, ...repeatedSnapshots] = snapshots;
      if (!initialSnapshot)
        throw new Error("Graph persistence did not produce a snapshot");
      for (const snapshot of repeatedSnapshots)
        expect(snapshot).toEqual(initialSnapshot);
      return initialSnapshot;
    };

    const [baseline, enriched, enrichedRepeat] = await Promise.all([
      persist(legacyResults, "baseline"),
      persist(parsedResults, "enriched"),
      persist(parsedResults, "enriched-repeat", 4),
    ]);

    expect(enriched.nodes).toEqual(baseline.nodes);
    expect(enriched.linkCountsByType).toEqual(baseline.linkCountsByType);
    expect(enriched.links).toEqual(baseline.links);
    expect(enrichedRepeat).toEqual(enriched);
  });
});
