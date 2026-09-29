import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
import type { ParsedAstFileResult } from "@workspace/contracts";
import { GraphPersisterService } from "./persist-ast-graph.js";
import { buildParseResponse } from "../ast/ast-worker.js";

// TDD-SOURCE: issue #508 Phase 3 staleness and graph state-transition robustness (D9)
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase3.md
// TDD-SOURCE: docs/gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md

const TARGET = "src/target.ts";
const CALLER = "src/caller.ts";
const SUB = "src/sub.ts";
const BARREL = "src/barrel.ts";

function targetSource(revision: number, withBase = true): string {
  return [
    `// revision ${revision}`,
    "export function evalTarget(): number {",
    `  return ${revision};`,
    "}",
    ...(withBase ? ["export class EvalBase {}"] : []),
    "",
  ].join("\n");
}

const SOURCES: Record<string, string> = {
  [CALLER]: [
    'import { evalTarget } from "./target";',
    "export function evalCaller(): number {",
    "  return evalTarget();",
    "}",
    "",
  ].join("\n"),
  [SUB]: [
    'import { EvalBase } from "./target";',
    "export class EvalSub extends EvalBase {}",
    "",
  ].join("\n"),
  [BARREL]: 'export { evalTarget } from "./target";\n',
};

let workspaceRoot = "";

/** Writes `code` into the temp workspace (ScopeResolver resolves imports against real files)
 *  and parses it with the real worker parser. */
async function parsed(
  file: string,
  code: string,
): Promise<ParsedAstFileResult> {
  const absolute = path.join(workspaceRoot, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, code);
  const response = await buildParseResponse({
    taskId: file,
    filePath: file,
    code,
    language: "typescript",
  });
  return { file, hash: `hash-${code.length}`, data: response.data! };
}

/**
 * Real temp `GraphStore` + real parser: the per-file replace is asserted as a state diff over the
 * persisted `(sourceKey, targetKey, linkType)` triples, which is what impact reads.
 */
describe("GraphPersisterService: incoming edges survive a per-file replace (#508 D9)", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  const persister = new GraphPersisterService();

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-d9-"));
    workspaceRoot = tmpDir;
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
    projectId = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    }).id;
    await persist([
      await parsed(TARGET, targetSource(1)),
      ...(await Promise.all(
        Object.entries(SOURCES).map(([file, code]) => parsed(file, code)),
      )),
    ]);
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function persist(parsedResults: ParsedAstFileResult[]) {
    return persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: [],
    });
  }

  function linkTriples(): string[] {
    const keys = new Map(
      store.graph.getAllNodes().map((node) => [node.id, node.node_key]),
    );
    return store.graph
      .getAllLinks()
      .map(
        (link) =>
          `${keys.get(link.source_node_id) ?? "<DANGLING>"} -${link.link_type}-> ${
            keys.get(link.target_node_id) ?? "<DANGLING>"
          }`,
      )
      .sort();
  }

  const CALLS = `${CALLER}#evalCaller -calls-> ${TARGET}#evalTarget`;
  const EXTENDS = `${SUB}#EvalSub -extends-> ${TARGET}#EvalBase`;
  const REEXPORT = `${BARREL} -depends_on-> ${TARGET}#evalTarget`;

  it("[happy] the baseline graph has the calls, extends and re-export edges into target.ts", () => {
    expect(linkTriples()).toEqual(
      expect.arrayContaining([CALLS, EXTENDS, REEXPORT]),
    );
  });

  it("[state-diff] re-parsing only target.ts keeps every external incoming edge, with no dangling row", async () => {
    const before = linkTriples();
    await persist([await parsed(TARGET, targetSource(2))]);
    const after = linkTriples();
    expect(after).toEqual(before);
    expect(after.join("\n")).not.toContain("<DANGLING>");
  });

  it("[state-diff] a removed symbol drops its incoming edge instead of leaving it dangling", async () => {
    await persist([await parsed(TARGET, targetSource(2, false))]);
    const after = linkTriples();
    expect(after).not.toContain(EXTENDS);
    expect(after).toEqual(expect.arrayContaining([CALLS, REEXPORT]));
    expect(after.join("\n")).not.toContain("<DANGLING>");
  });

  it("[state-diff] re-parsing target.ts with a dependent in the same batch never duplicates the edge", async () => {
    const before = linkTriples();
    await persist([
      await parsed(TARGET, targetSource(3)),
      await parsed(CALLER, SOURCES[CALLER]),
    ]);
    expect(linkTriples()).toEqual(before);
  });

  it("[stress] repeated re-parse cycles do not accumulate or lose links", async () => {
    const before = linkTriples();
    for (let revision = 2; revision < 8; revision++) {
      await persist([await parsed(TARGET, targetSource(revision))]);
    }
    expect(linkTriples()).toEqual(before);
    expect(store.graph.pruneOrphanedLinks()).toBe(0);
  });

  it("[invalid-input] an empty batch captures and re-attaches nothing and leaves the graph unchanged", async () => {
    const before = linkTriples();
    await persist([]);
    expect(linkTriples()).toEqual(before);
    expect(store.graph.getExternalIncomingLinks([])).toEqual([]);
  });

  it("[error-handling] deleting target.ts (delta toDelete path) removes its incoming edges with it", () => {
    store.graph.deleteNodesForPath(TARGET);
    const after = linkTriples();
    expect(after.join("\n")).not.toContain("<DANGLING>");
    expect(after.join("\n")).not.toContain(TARGET);
  });
});
