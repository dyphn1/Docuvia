import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  CallsProjectionCallerPolicies,
  isDiscoverableSourceFile,
  LinkTypes,
  MAX_FILE_SIZE_BYTES,
  type BlastRadiusEntry,
  type IGraphStore,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { AstProcessingService } from "../../lib/core/src/ast/ast-processing.service.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import { GraphPersisterService } from "../../lib/core/src/graph/persist-ast-graph.js";
import { ImpactService } from "../../lib/core/src/impact/impact.service.js";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import { GraphStore } from "../../lib/schema/src/index.js";
import {
  buildQualifiedBaseKey,
  buildUniqueNodeKey,
} from "../../lib/core/src/graph/node-key.js";
import { ANONYMOUS_SYMBOL_NAME } from "../../lib/core/src/constants/symbols.js";

type Options = {
  readonly repositoryRoot: string;
  readonly outputPath: string;
  readonly summaryPath: string;
};

type FunctionLocation = {
  readonly nodeKey: string;
  readonly filePath: string;
  readonly line: number;
  readonly name: string;
};

type ImpactRun = {
  readonly nodeKeys: ReadonlySet<string>;
  readonly entries: readonly BlastRadiusEntry[];
};

type Projection = {
  readonly store: GraphStore;
  readonly projectId: number;
  readonly nodeKeysById: ReadonlyMap<number, string>;
  readonly nodesByKey: ReadonlyMap<
    string,
    ReturnType<GraphStore["graph"]["getAllNodes"]>[number]
  >;
  readonly callerKeysByTarget: ReadonlyMap<string, ReadonlySet<string>>;
  readonly callerCandidateKeysByTarget: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
};

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !["--root", "--out", "--summary-out"].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(
        "Usage: exact-caller-impact-parity.mts --root <repository> --out <summary.json> --summary-out <summary.md>",
      );
    }
    values.set(key, value);
  }
  const repositoryRoot = values.get("--root");
  const outputPath = values.get("--out");
  const summaryPath = values.get("--summary-out");
  if (!repositoryRoot || !outputPath || !summaryPath) {
    throw new Error(
      "Usage: exact-caller-impact-parity.mts --root <repository> --out <summary.json> --summary-out <summary.md>",
    );
  }
  return {
    repositoryRoot: path.resolve(repositoryRoot),
    outputPath: path.resolve(outputPath),
    summaryPath: path.resolve(summaryPath),
  };
}

function discoverSourceFiles(root: string) {
  const files: Array<{ file: string; hash: string; code: string }> = [];
  const listedFiles = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  )
    .toString("utf8")
    .split("\0");
  for (const file of listedFiles) {
    if (!file || !isDiscoverableSourceFile(file)) continue;
    const absolutePath = path.resolve(root, file);
    if (!existsSync(absolutePath)) continue;
    if (statSync(absolutePath).size > MAX_FILE_SIZE_BYTES) continue;
    const bytes = readFileSync(absolutePath);
    files.push({
      file,
      hash: createSha256(bytes),
      code: bytes.toString("utf8"),
    });
  }
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

function createSha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function functionLocations(
  parsedResults: readonly ParsedAstFileResult[],
): Map<string, FunctionLocation> {
  const locations = new Map<string, FunctionLocation>();
  for (const result of parsedResults) {
    const usedNodeKeys = new Set([result.file]);
    for (const fn of result.data.functions ?? []) {
      const nodeKey = buildUniqueNodeKey(
        usedNodeKeys,
        buildQualifiedBaseKey(result.file, fn.name, fn.containerName),
        fn.startLine,
      );
      usedNodeKeys.add(nodeKey);
      if (fn.name === ANONYMOUS_SYMBOL_NAME) continue;
      locations.set(nodeKey, {
        nodeKey,
        filePath: result.file,
        line: fn.startLine,
        name: fn.name,
      });
    }
  }
  return locations;
}

async function persistProjection(
  repositoryRoot: string,
  databasePath: string,
  policy: (typeof CallsProjectionCallerPolicies)[keyof typeof CallsProjectionCallerPolicies],
  parsedResults: ParsedAstFileResult[],
): Promise<Projection> {
  process.stdout.write(`Persisting ${policy} graph...\n`);
  const store = await GraphStore.open({ dbPath: databasePath });
  const projectId = store.projects.insert({
    name: `exact-caller-parity-${policy}`,
    repoUrl: `file:///${policy}`,
  }).id;
  try {
    await new GraphPersisterService(
      new CallResolutionHypothesisService(),
      policy,
    ).persist({
      store,
      workspaceRoot: repositoryRoot,
      projectId,
      parsedResults,
      sourceIndexComplete: true,
      tags: [],
    });
    process.stdout.write(`Persisted ${policy} graph.\n`);
    return projectionFromStore(store, projectId);
  } catch (error) {
    await store.close();
    throw error;
  }
}

function projectionFromStore(store: GraphStore, projectId: number): Projection {
  const nodes = store.graph
    .getAllNodes()
    .filter((node) => node.project_id === projectId);
  const nodeKeysById = new Map(
    nodes.flatMap((node) =>
      node.node_key ? [[node.id, node.node_key] as const] : [],
    ),
  );
  const nodesByKey = new Map(
    nodes.flatMap((node) =>
      node.node_key ? [[node.node_key, node] as const] : [],
    ),
  );
  const callerKeysByTarget = new Map<string, Set<string>>();
  const callerCandidateKeysByTarget = new Map<string, Set<string>>();
  for (const link of store.graph.getAllLinks()) {
    const sourceKey = nodeKeysById.get(link.source_node_id);
    const targetKey = nodeKeysById.get(link.target_node_id);
    if (!sourceKey || !targetKey) continue;
    if (link.link_type === LinkTypes.CALLER_CANDIDATE) {
      const candidates =
        callerCandidateKeysByTarget.get(targetKey) ?? new Set<string>();
      candidates.add(sourceKey);
      callerCandidateKeysByTarget.set(targetKey, candidates);
      continue;
    }
    if (link.link_type !== LinkTypes.CALLS) continue;
    const callers = callerKeysByTarget.get(targetKey) ?? new Set<string>();
    callers.add(sourceKey);
    callerKeysByTarget.set(targetKey, callers);
  }
  return {
    store,
    projectId,
    nodeKeysById,
    nodesByKey,
    callerKeysByTarget,
    callerCandidateKeysByTarget,
  };
}

function exactTargetStore(
  store: GraphStore,
  targetNode: Projection["nodesByKey"] extends ReadonlyMap<string, infer T>
    ? T
    : never,
): IGraphStore {
  const targetFilePath = targetNode.path_patterns[0];
  const target = {
    id: targetNode.id,
    name: targetNode.name,
    type: targetNode.type,
    ...(targetFilePath ? { filePath: targetFilePath } : {}),
  };
  let targetLookupPending = true;
  const graph = new Proxy(store.graph, {
    get(graphTarget, property) {
      if (property === "findNodeByName") {
        return (name: string) => {
          if (targetLookupPending && name === targetNode.name) {
            targetLookupPending = false;
            return target;
          }
          return graphTarget.findNodeByName(name);
        };
      }
      const value: unknown = Reflect.get(graphTarget, property, graphTarget);
      return typeof value === "function" ? value.bind(graphTarget) : value;
    },
  });
  const resolutionRepository = store.callSiteResolutions
    ? new Proxy(store.callSiteResolutions, {
        get(repository, property) {
          // Resolution summaries annotate entries but do not select impacted nodes. Returning
          // no rows avoids re-reading the full project resolution table for every callee.
          if (property === "getAllForProject") return () => [];
          const value: unknown = Reflect.get(repository, property, repository);
          return typeof value === "function" ? value.bind(repository) : value;
        },
      })
    : undefined;
  return new Proxy(store, {
    get(storeTarget, property) {
      if (property === "graph") return graph;
      if (property === "callSiteResolutions") return resolutionRepository;
      return Reflect.get(storeTarget, property, storeTarget);
    },
  }) as IGraphStore;
}

function runImpact(projection: Projection, targetNodeKey: string): ImpactRun {
  const targetNode = projection.nodesByKey.get(targetNodeKey);
  if (!targetNode) throw new Error(`Missing target node ${targetNodeKey}`);
  const impact = new ImpactService();
  const builtNodeKeys: string[] = [];
  const instrumented = impact as unknown as {
    buildEntry: (
      store: IGraphStore,
      nodeId: number,
      name: string,
      type: string,
    ) => BlastRadiusEntry;
    getBlastRadius: (
      store: IGraphStore,
      target: string,
    ) => BlastRadiusEntry[] | undefined;
  };
  const originalBuildEntry = instrumented.buildEntry;
  instrumented.buildEntry = function (
    this: ImpactService,
    store: IGraphStore,
    nodeId: number,
    name: string,
    type: string,
  ): BlastRadiusEntry {
    builtNodeKeys.push(store.graph.getNodeKeyById?.(nodeId) ?? `id:${nodeId}`);
    // The evaluator compares impacted node identities; L3 "why" text cannot change traversal.
    // Keep the real ImpactService walk while skipping one L3 lookup per returned entry.
    return { name, type };
  };
  try {
    const entries =
      instrumented.getBlastRadius(
        exactTargetStore(projection.store, targetNode),
        targetNode.name,
      ) ?? [];
    if (entries.length !== builtNodeKeys.length) {
      throw new Error(
        `Impact identity capture mismatch for ${targetNodeKey}: ${entries.length} entries, ${builtNodeKeys.length} node keys`,
      );
    }
    return { nodeKeys: new Set(builtNodeKeys), entries };
  } finally {
    instrumented.buildEntry = originalBuildEntry;
  }
}

function callerKeys(
  projection: Projection,
  targetNodeKey: string,
): readonly string[] {
  return [...(projection.callerKeysByTarget.get(targetNodeKey) ?? [])].sort();
}

function explainMissingCaller(
  nodeKey: string,
  targetNodeKey: string,
  v1: Projection,
  v2: Projection,
  v2CandidateKeys: readonly string[],
  location: FunctionLocation,
): string {
  const v1Callers = callerKeys(v1, targetNodeKey);
  const v2Callers = callerKeys(v2, targetNodeKey);
  if (!v1Callers.includes(nodeKey)) {
    return `V1 impact reached ${nodeKey} through a non-calls incoming relation; v2 has no matching named-function impact entry.`;
  }
  const fileCaller = location.filePath;
  if (v2CandidateKeys.includes(nodeKey)) {
    return `V2 persisted caller_candidate context from ${nodeKey}, but ImpactService did not include it for ${targetNodeKey}.`;
  }
  if (v2Callers.includes(fileCaller)) {
    return `V2 retained a file-node calls edge from ${fileCaller}; the persisted exact-caller graph has no unique lexical-parent path to the V1 ScopeResolver caller ${nodeKey}.`;
  }
  const observedCallers = v2Callers.length > 0 ? v2Callers.join(", ") : "none";
  return `V1 directly attributed a calls edge to ${nodeKey}; v2's direct caller set is ${observedCallers}, and no persisted lexical-parent path reaches that function.`;
}

function sortedUnique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort((left, right) =>
    String(left).localeCompare(String(right)),
  );
}

function markdownSummary(totals: Record<string, number>): string {
  return `Parity summary: callee nodes ${totals.calleeNodes}; named-function impact pairs v1 ${totals.v1NamedFunctionImpactPairs}, v2 ${totals.v2NamedFunctionImpactPairs}; missing ${totals.missingNamedFunctionImpactPairs}; added ${totals.addedNamedFunctionImpactPairs}; unique missing nodes ${totals.uniqueMissingNamedFunctionNodes}; unique added nodes ${totals.uniqueAddedNamedFunctionNodes}.`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sourceFiles = discoverSourceFiles(options.repositoryRoot);
  process.stdout.write(
    `Parsing ${sourceFiles.length} discoverable source files...\n`,
  );
  const pool = new AstWorkerPool();
  const processor = new AstProcessingService({
    initialize: async () => pool.initialize(2),
    parse: (request) => pool.parse(request),
    terminate: () => pool.terminate(),
    serializeBatch: (run) => run(),
  });
  const parsed = await processor.processFiles(
    options.repositoryRoot,
    sourceFiles,
  );
  if (parsed.failures.length > 0) {
    throw new Error(
      `Source parsing failed for ${parsed.failures.length} files`,
    );
  }
  process.stdout.write(
    `Parsed ${parsed.parsed.length} files; building policy graphs...\n`,
  );
  const locations = functionLocations(parsed.parsed);
  const databaseRoot = mkdtempSync(
    path.join(os.tmpdir(), "docuvia-exact-caller-impact-"),
  );
  let v1: Projection | undefined;
  let v2: Projection | undefined;
  try {
    v1 = await persistProjection(
      options.repositoryRoot,
      path.join(databaseRoot, "scope-resolver-v1.db"),
      CallsProjectionCallerPolicies.SCOPE_RESOLVER_V1,
      parsed.parsed,
    );
    v2 = await persistProjection(
      options.repositoryRoot,
      path.join(databaseRoot, "exact-enclosing-v2.db"),
      CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
      parsed.parsed,
    );
    const report = buildReport(parsed.parsed.length, locations, v1, v2);
    mkdirSync(path.dirname(options.outputPath), { recursive: true });
    mkdirSync(path.dirname(options.summaryPath), { recursive: true });
    writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(options.summaryPath, `${report.summary}\n`);
    process.stdout.write(`${report.summary}\n`);
  } finally {
    if (v1) await v1.store.close();
    if (v2) await v2.store.close();
    rmSync(databaseRoot, { recursive: true, force: true });
  }
}

function buildReport(
  parsedFileCount: number,
  locations: ReadonlyMap<string, FunctionLocation>,
  v1: Projection,
  v2: Projection,
) {
  const targetKeys = sortedUnique([
    ...[...v1.callerKeysByTarget.keys()],
    ...[...v2.callerKeysByTarget.keys()],
  ]);
  const missingTargets = targetKeys.filter(
    (targetKey) =>
      !v1.nodesByKey.has(targetKey) || !v2.nodesByKey.has(targetKey),
  );
  if (missingTargets.length > 0) {
    throw new Error(
      `Cannot compare ${missingTargets.length} call targets present under only one policy`,
    );
  }
  process.stdout.write(
    `Comparing impacts for ${targetKeys.length} callee nodes...\n`,
  );
  const missingByNode = new Map<
    string,
    {
      readonly location: FunctionLocation;
      readonly callees: Array<{
        readonly nodeKey: string;
        readonly name: string;
        readonly why: string;
      }>;
    }
  >();
  const addedByNode = new Map<
    string,
    {
      readonly location: FunctionLocation;
      readonly callees: Array<{
        readonly nodeKey: string;
        readonly name: string;
      }>;
    }
  >();
  let v1NamedFunctionImpactPairs = 0;
  let v2NamedFunctionImpactPairs = 0;
  let missingNamedFunctionImpactPairs = 0;
  let addedNamedFunctionImpactPairs = 0;
  let comparedCalleeCount = 0;

  for (const targetKey of targetKeys) {
    comparedCalleeCount++;
    if (comparedCalleeCount % 100 === 0) {
      process.stdout.write(
        `Compared ${comparedCalleeCount}/${targetKeys.length} callees.\n`,
      );
    }
    const v1Target = v1.nodesByKey.get(targetKey);
    const v2Target = v2.nodesByKey.get(targetKey);
    if (!v1Target || !v2Target) continue;
    const v1Impact = runImpact(v1, targetKey).nodeKeys;
    const v2Impact = runImpact(v2, targetKey).nodeKeys;
    const v1Functions = [...v1Impact].filter((key) => locations.has(key));
    const v2Functions = [...v2Impact].filter((key) => locations.has(key));
    v1NamedFunctionImpactPairs += v1Functions.length;
    v2NamedFunctionImpactPairs += v2Functions.length;
    const missing = v1Functions.filter((key) => !v2Impact.has(key));
    const added = v2Functions.filter((key) => !v1Impact.has(key));
    missingNamedFunctionImpactPairs += missing.length;
    addedNamedFunctionImpactPairs += added.length;
    for (const nodeKey of missing) {
      const location = locations.get(nodeKey);
      if (!location) continue;
      const row = missingByNode.get(nodeKey) ?? { location, callees: [] };
      row.callees.push({
        nodeKey: targetKey,
        name: v1Target.name,
        why: explainMissingCaller(
          nodeKey,
          targetKey,
          v1,
          v2,
          [...(v2.callerCandidateKeysByTarget.get(targetKey) ?? [])].sort(),
          location,
        ),
      });
      missingByNode.set(nodeKey, row);
    }
    for (const nodeKey of added) {
      const location = locations.get(nodeKey);
      if (!location) continue;
      const row = addedByNode.get(nodeKey) ?? { location, callees: [] };
      row.callees.push({ nodeKey: targetKey, name: v2Target.name });
      addedByNode.set(nodeKey, row);
    }
  }

  const missingNamedFunctionNodes = [...missingByNode.values()]
    .map(({ location, callees }) => ({
      ...location,
      missingFromCallees: callees.sort((left, right) =>
        left.nodeKey.localeCompare(right.nodeKey),
      ),
    }))
    .sort((left, right) => left.nodeKey.localeCompare(right.nodeKey));
  const addedNamedFunctionNodes = [...addedByNode.values()]
    .map(({ location, callees }) => ({
      ...location,
      addedForCallees: callees.sort((left, right) =>
        left.nodeKey.localeCompare(right.nodeKey),
      ),
    }))
    .sort((left, right) => left.nodeKey.localeCompare(right.nodeKey));
  const totals = {
    parsedFiles: parsedFileCount,
    calleeNodes: targetKeys.length,
    v1NamedFunctionImpactPairs,
    v2NamedFunctionImpactPairs,
    missingNamedFunctionImpactPairs,
    addedNamedFunctionImpactPairs,
    uniqueMissingNamedFunctionNodes: missingNamedFunctionNodes.length,
    uniqueAddedNamedFunctionNodes: addedNamedFunctionNodes.length,
  };
  return {
    policies: {
      baseline: CallsProjectionCallerPolicies.SCOPE_RESOLVER_V1,
      candidate: CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
    },
    totals,
    missingNamedFunctionNodes,
    addedNamedFunctionNodes,
    summary: markdownSummary(totals),
  };
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
