import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
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
import {
  computeRiskLevelFromCounts,
  ImpactService,
} from "../../lib/core/src/impact/impact.service.js";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import { GraphStore } from "../../lib/schema/src/index.js";
import {
  buildQualifiedBaseKey,
  buildUniqueNodeKey,
} from "../../lib/core/src/graph/node-key.js";
import { ANONYMOUS_SYMBOL_NAME } from "../../lib/core/src/constants/symbols.js";
import {
  EXACT_CALLER_ADDITION_CATEGORIES,
  hasPathSegment,
  type ExactCallerAdditionCategory,
} from "./exact-caller-impact-parity-sampling.js";

type Options = {
  readonly repositoryRoot: string;
  readonly outputPath: string;
  readonly summaryPath: string;
  readonly excludedPathPrefixes: readonly string[];
  readonly excludedPathSegments: readonly string[];
};

type FunctionLocation = {
  readonly nodeKey: string;
  readonly filePath: string;
  readonly line: number;
  readonly endLine: number;
  readonly name: string;
};

type SourceLocation = {
  readonly nodeKey: string;
  readonly filePath: string;
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly name: string;
  readonly kind: "file" | "class" | "function" | "variable";
};

type ImpactRun = {
  readonly nodeKeys: ReadonlySet<string>;
  readonly entries: readonly BlastRadiusEntry[];
  readonly entriesByNodeKey: ReadonlyMap<string, BlastRadiusEntry>;
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
  readonly lexicalParentKeysByChild: ReadonlyMap<string, ReadonlySet<string>>;
  readonly lexicalOwnerKeysByChild: ReadonlyMap<string, ReadonlySet<string>>;
};

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  const excludedPathPrefixes: string[] = [];
  const excludedPathSegments: string[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      ![
        "--root",
        "--out",
        "--summary-out",
        "--exclude-prefix",
        "--exclude-segment",
      ].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(
        "Usage: exact-caller-impact-parity.mts --root <repository> --out <summary.json> --summary-out <summary.md> [--exclude-prefix <path-prefix>] [--exclude-segment <directory-name>]",
      );
    }
    if (key === "--exclude-prefix") {
      excludedPathPrefixes.push(
        value.replaceAll("\\", "/").replace(/^\/+/, ""),
      );
      continue;
    }
    if (key === "--exclude-segment") {
      if (value.includes("/") || value.includes("\\")) {
        throw new Error("--exclude-segment must be a single path segment");
      }
      excludedPathSegments.push(value);
      continue;
    }
    values.set(key, value);
  }
  const repositoryRoot = values.get("--root");
  const outputPath = values.get("--out");
  const summaryPath = values.get("--summary-out");
  if (!repositoryRoot || !outputPath || !summaryPath) {
    throw new Error(
      "Usage: exact-caller-impact-parity.mts --root <repository> --out <summary.json> --summary-out <summary.md> [--exclude-prefix <path-prefix>] [--exclude-segment <directory-name>]",
    );
  }
  return {
    repositoryRoot: path.resolve(repositoryRoot),
    outputPath: path.resolve(outputPath),
    summaryPath: path.resolve(summaryPath),
    excludedPathPrefixes,
    excludedPathSegments,
  };
}

function discoverSourceFiles(
  root: string,
  excludedPathPrefixes: readonly string[],
  excludedPathSegments: readonly string[],
) {
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
    const relativeFile = file.replaceAll("\\", "/");
    if (
      excludedPathPrefixes.some((prefix) => relativeFile.startsWith(prefix)) ||
      excludedPathSegments.some((segment) =>
        hasPathSegment(relativeFile, segment),
      )
    ) {
      continue;
    }
    const absolutePath = path.resolve(root, file);
    let fileDescriptor: number;
    try {
      fileDescriptor = openSync(absolutePath, "r");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    try {
      if (fstatSync(fileDescriptor).size > MAX_FILE_SIZE_BYTES) continue;
      const bytes = readFileSync(fileDescriptor);
      files.push({
        file,
        hash: createSha256(bytes),
        code: bytes.toString("utf8"),
      });
    } finally {
      closeSync(fileDescriptor);
    }
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
        endLine: fn.endLine,
        name: fn.name,
      });
    }
  }
  return locations;
}

function sourceLocations(
  parsedResults: readonly ParsedAstFileResult[],
): Map<string, SourceLocation> {
  const locations = new Map<string, SourceLocation>();
  for (const result of parsedResults) {
    const usedNodeKeys = new Set([result.file]);
    locations.set(result.file, {
      nodeKey: result.file,
      filePath: result.file,
      startLine: null,
      endLine: null,
      name: result.file,
      kind: "file",
    });
    for (const fn of result.data.functions ?? []) {
      const nodeKey = buildUniqueNodeKey(
        usedNodeKeys,
        buildQualifiedBaseKey(result.file, fn.name, fn.containerName),
        fn.startLine,
      );
      usedNodeKeys.add(nodeKey);
      locations.set(nodeKey, {
        nodeKey,
        filePath: result.file,
        startLine: fn.startLine,
        endLine: fn.endLine,
        name: fn.name,
        kind: "function",
      });
    }
    for (const cls of result.data.classes ?? []) {
      const nodeKey = buildUniqueNodeKey(
        usedNodeKeys,
        `${result.file}#${cls.name}`,
        cls.startLine,
      );
      usedNodeKeys.add(nodeKey);
      locations.set(nodeKey, {
        nodeKey,
        filePath: result.file,
        startLine: cls.startLine,
        endLine: cls.endLine,
        name: cls.name,
        kind: "class",
      });
    }
    for (const variable of result.data.variables ?? []) {
      const nodeKey = buildUniqueNodeKey(
        usedNodeKeys,
        `${result.file}#${variable.name}`,
        variable.startLine,
      );
      usedNodeKeys.add(nodeKey);
      locations.set(nodeKey, {
        nodeKey,
        filePath: result.file,
        startLine: variable.startLine,
        endLine: variable.endLine,
        name: variable.name,
        kind: "variable",
      });
    }
  }
  return locations;
}

function sourceSnippet(
  location: SourceLocation | undefined,
  sourceByPath: ReadonlyMap<string, string>,
): string | null {
  if (!location) return null;
  const code = sourceByPath.get(location.filePath);
  if (code === undefined) return null;
  const lines = code.split("\n");
  const firstLine = Math.max(0, (location.startLine ?? 0) - 2);
  const preferredEnd =
    location.endLine === null
      ? firstLine + 17
      : Math.min(location.endLine + 1, (location.startLine ?? 0) + 19);
  const lastLine = Math.min(
    lines.length,
    Math.max(firstLine + 1, preferredEnd),
  );
  return lines
    .slice(firstLine, lastLine)
    .map((line, index) => `${firstLine + index + 1}: ${line}`)
    .join("\n");
}

function hasLexicalAncestor(
  projection: Projection,
  childKey: string,
  ancestorKey: string,
): boolean {
  const pending = [childKey];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const child = pending.pop();
    if (child === undefined || visited.has(child)) continue;
    visited.add(child);
    const parents = projection.lexicalParentKeysByChild.get(child) ?? [];
    for (const parent of parents) {
      if (parent === ancestorKey) return true;
      pending.push(parent);
    }
  }
  return false;
}

function hasClassOwner(
  projection: Projection,
  childKey: string,
  ownerKey: string,
): boolean {
  return (
    projection.lexicalOwnerKeysByChild.get(childKey)?.has(ownerKey) ?? false
  );
}

function spanOverlapsWithoutContainment(
  left: SourceLocation | undefined,
  right: SourceLocation | undefined,
): boolean {
  if (
    !left ||
    !right ||
    left.kind !== "function" ||
    right.kind !== "function" ||
    left.startLine === null ||
    left.endLine === null ||
    right.startLine === null ||
    right.endLine === null
  ) {
    return false;
  }
  const overlaps =
    left.startLine <= right.endLine && right.startLine <= left.endLine;
  const leftContainsRight =
    left.startLine <= right.startLine && left.endLine >= right.endLine;
  const rightContainsLeft =
    right.startLine <= left.startLine && right.endLine >= left.endLine;
  const equal =
    left.startLine === right.startLine && left.endLine === right.endLine;
  return equal || (overlaps && !leftContainsRight && !rightContainsLeft);
}

function finalName(expression: string): string {
  return expression.match(/[A-Za-z_$][\w$]*\s*$/)?.[0]?.trim() ?? expression;
}

function hasTiedCallSpan(
  target: SourceLocation | undefined,
  candidate: SourceLocation | undefined,
  parsedResultsByFile: ReadonlyMap<string, ParsedAstFileResult>,
): boolean {
  if (
    !target ||
    !candidate ||
    candidate.kind !== "function" ||
    target.name.length === 0
  ) {
    return false;
  }
  const result = parsedResultsByFile.get(candidate.filePath);
  if (!result) return false;
  for (const call of result.data.calls ?? []) {
    if (
      call.sourceFunction !== candidate.name ||
      finalName(call.targetFunction) !== target.name ||
      !Number.isSafeInteger(call.startLine) ||
      call.startLine < 0
    ) {
      continue;
    }
    const enclosing = (result.data.functions ?? []).filter(
      (fn) => fn.startLine <= call.startLine && fn.endLine >= call.startLine,
    );
    if (enclosing.length === 0) continue;
    const shortestSpan = Math.min(
      ...enclosing.map((fn) => fn.endLine - fn.startLine),
    );
    if (
      enclosing.filter((fn) => fn.endLine - fn.startLine === shortestSpan)
        .length > 1
    ) {
      return true;
    }
  }
  return false;
}

function classifyAddition(input: {
  readonly addedCallerKey: string;
  readonly targetKey: string;
  readonly target: SourceLocation | undefined;
  readonly entry: BlastRadiusEntry | undefined;
  readonly projection: Projection;
  readonly sourceLocations: ReadonlyMap<string, SourceLocation>;
  readonly parsedResultsByFile: ReadonlyMap<string, ParsedAstFileResult>;
}): ExactCallerAdditionCategory {
  const addedLocation = input.sourceLocations.get(input.addedCallerKey);
  const directCallers = callerKeys(input.projection, input.targetKey);
  if (input.entry?.edgeSource === "caller-candidate") {
    const ambiguous =
      hasTiedCallSpan(input.target, addedLocation, input.parsedResultsByFile) ||
      directCallers.some((directCallerKey) =>
        spanOverlapsWithoutContainment(
          input.sourceLocations.get(directCallerKey),
          addedLocation,
        ),
      );
    return ambiguous ? "ambiguous-spans" : "caller-candidate";
  }
  if (
    addedLocation?.kind === "class" ||
    directCallers.some((directCallerKey) =>
      hasClassOwner(input.projection, directCallerKey, input.addedCallerKey),
    )
  ) {
    return "class-ownership";
  }
  if (
    (addedLocation?.kind === "function" &&
      addedLocation.name === ANONYMOUS_SYMBOL_NAME &&
      directCallers.includes(input.addedCallerKey)) ||
    directCallers.some((directCallerKey) =>
      hasLexicalAncestor(
        input.projection,
        directCallerKey,
        input.addedCallerKey,
      ),
    )
  ) {
    return "anonymous-callback/lexical-parent";
  }
  return "other";
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
  const lexicalParentKeysByChild = new Map<string, Set<string>>();
  const lexicalOwnerKeysByChild = new Map<string, Set<string>>();
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
    if (
      link.link_type === LinkTypes.LEXICAL_PARENT ||
      link.link_type === LinkTypes.LEXICAL_OWNER
    ) {
      const linksByChild =
        link.link_type === LinkTypes.LEXICAL_PARENT
          ? lexicalParentKeysByChild
          : lexicalOwnerKeysByChild;
      const parents = linksByChild.get(targetKey) ?? new Set<string>();
      parents.add(sourceKey);
      linksByChild.set(targetKey, parents);
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
    lexicalParentKeysByChild,
    lexicalOwnerKeysByChild,
  };
}

function exactTargetStore(
  store: GraphStore,
  targetNode: Projection["nodesByKey"] extends ReadonlyMap<string, infer T>
    ? T
    : never,
): IGraphStore {
  // `path_patterns` is the raw JSON database column on `getAllNodes()` rows.
  // `findNodeByName()` exposes the parsed first path; derive the same value from
  // the canonical node key so this audit proxy matches the production repo API.
  const targetFilePath = targetNode.node_key?.split("#", 1)[0];
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
    return {
      nodeKeys: new Set(builtNodeKeys),
      entries,
      entriesByNodeKey: new Map(
        builtNodeKeys.map((nodeKey, index) => [
          nodeKey,
          entries[index] as BlastRadiusEntry,
        ]),
      ),
    };
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

function locationForNode(
  nodeKey: string,
  projection: Projection,
  locations: ReadonlyMap<string, SourceLocation>,
): SourceLocation | undefined {
  const location = locations.get(nodeKey);
  if (location) return location;
  const node = projection.nodesByKey.get(nodeKey);
  const filePath = node?.path_patterns[0];
  if (!node || !filePath) return undefined;
  return {
    nodeKey,
    filePath,
    startLine: null,
    endLine: null,
    name: node.name,
    kind: "file",
  };
}

function impactFilePaths(
  run: ImpactRun,
  projection: Projection,
  locations: ReadonlyMap<string, SourceLocation>,
): Set<string> {
  return new Set(
    [...run.nodeKeys]
      .map(
        (nodeKey) => locationForNode(nodeKey, projection, locations)?.filePath,
      )
      .filter((filePath): filePath is string => filePath !== undefined),
  );
}

function publicLocation(location: SourceLocation | undefined) {
  return location
    ? {
        symbol: location.name,
        file: location.filePath,
        line: location.startLine === null ? null : location.startLine + 1,
        endLine: location.endLine === null ? null : location.endLine + 1,
        nodeKey: location.nodeKey,
      }
    : null;
}

function markdownSummary(totals: Record<string, number>): string {
  return `Parity/recall vs v1 summary: callee nodes ${totals.calleeNodes}; named-function impact pairs v1 ${totals.v1NamedFunctionImpactPairs}, v2 ${totals.v2NamedFunctionImpactPairs}; missing ${totals.missingNamedFunctionImpactPairs}; added ${totals.addedNamedFunctionImpactPairs}; unique missing nodes ${totals.uniqueMissingNamedFunctionNodes}; unique added nodes ${totals.uniqueAddedNamedFunctionNodes}.`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sourceFiles = discoverSourceFiles(
    options.repositoryRoot,
    options.excludedPathPrefixes,
    options.excludedPathSegments,
  );
  if (
    options.excludedPathPrefixes.length > 0 ||
    options.excludedPathSegments.length > 0
  ) {
    process.stdout.write(
      `Excluding path prefixes: ${options.excludedPathPrefixes.join(", ")}; path segments: ${options.excludedPathSegments.join(", ")}\n`,
    );
  }
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
  const allLocations = sourceLocations(parsed.parsed);
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
    const report = {
      ...buildReport(
        path.basename(options.repositoryRoot),
        parsed.parsed.length,
        locations,
        allLocations,
        sourceFiles,
        parsed.parsed,
        v1,
        v2,
      ),
      repositoryRoot: options.repositoryRoot,
      excludedPathPrefixes: options.excludedPathPrefixes,
      excludedPathSegments: options.excludedPathSegments,
    };
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
  repository: string,
  parsedFileCount: number,
  locations: ReadonlyMap<string, FunctionLocation>,
  allLocations: ReadonlyMap<string, SourceLocation>,
  sourceFiles: readonly { readonly file: string; readonly code: string }[],
  parsedResults: readonly ParsedAstFileResult[],
  v1: Projection,
  v2: Projection,
) {
  const sourceByPath = new Map(
    sourceFiles.map(({ file, code }) => [file, code] as const),
  );
  const parsedResultsByFile = new Map(
    parsedResults.map((result) => [result.file, result] as const),
  );
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
  const v2OnlyImpactAdditions: Array<{
    readonly repo: string;
    readonly sampleKey: string;
    readonly category: ExactCallerAdditionCategory;
    readonly target: NonNullable<ReturnType<typeof publicLocation>>;
    readonly addedCaller: NonNullable<ReturnType<typeof publicLocation>>;
    readonly evidence: {
      readonly targetSnippet: string | null;
      readonly addedCallerSnippet: string | null;
      readonly directCallerSnippets: Array<{
        readonly caller: NonNullable<ReturnType<typeof publicLocation>>;
        readonly snippet: string | null;
      }>;
    };
  }> = [];
  const fileBlastRadiusDeltaRows: Array<{
    readonly target: NonNullable<ReturnType<typeof publicLocation>>;
    readonly v1ImpactedFiles: number;
    readonly v2ImpactedFiles: number;
    readonly delta: number;
    readonly v1RiskLevel: string;
    readonly v2RiskLevel: string;
  }> = [];
  const worstFileLevelDropDetails: Array<{
    readonly target: NonNullable<ReturnType<typeof publicLocation>>;
    readonly delta: number;
    readonly v1ImpactedFiles: number;
    readonly v2ImpactedFiles: number;
    readonly v1OnlyFilePaths: readonly string[];
    readonly v2OnlyFilePaths: readonly string[];
    readonly v1IncomingLinkTypeCounts: Readonly<Record<string, number>>;
    readonly v2IncomingLinkTypeCounts: Readonly<Record<string, number>>;
    readonly v1DirectCallerCount: number;
    readonly v2DirectCallerCount: number;
    readonly v1DirectCallerSample: readonly string[];
    readonly v2DirectCallerSample: readonly string[];
  }> = [];

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
    const v1Run = runImpact(v1, targetKey);
    const v2Run = runImpact(v2, targetKey);
    const v1Impact = v1Run.nodeKeys;
    const v2Impact = v2Run.nodeKeys;
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

    const targetLocation = locationForNode(targetKey, v2, allLocations);
    for (const addedCallerKey of v2Impact) {
      if (v1Impact.has(addedCallerKey)) continue;
      const addedCallerLocation = locationForNode(
        addedCallerKey,
        v2,
        allLocations,
      );
      if (!targetLocation || !addedCallerLocation) continue;
      const entry = v2Run.entriesByNodeKey.get(addedCallerKey);
      const category = classifyAddition({
        addedCallerKey,
        targetKey,
        target: targetLocation,
        entry,
        projection: v2,
        sourceLocations: allLocations,
        parsedResultsByFile,
      });
      const directCallerSnippets = callerKeys(v2, targetKey)
        .slice(0, 3)
        .flatMap((directCallerKey) => {
          const directCallerLocation = locationForNode(
            directCallerKey,
            v2,
            allLocations,
          );
          if (!directCallerLocation) return [];
          return [
            {
              caller: publicLocation(directCallerLocation)!,
              snippet: sourceSnippet(directCallerLocation, sourceByPath),
            },
          ];
        });
      v2OnlyImpactAdditions.push({
        repo: repository,
        sampleKey: `${repository}\0${targetKey}\0${addedCallerKey}`,
        category,
        target: publicLocation(targetLocation)!,
        addedCaller: publicLocation(addedCallerLocation)!,
        evidence: {
          targetSnippet: sourceSnippet(targetLocation, sourceByPath),
          addedCallerSnippet: sourceSnippet(addedCallerLocation, sourceByPath),
          directCallerSnippets,
        },
      });
    }

    const v1FilePaths = impactFilePaths(v1Run, v1, allLocations);
    const v2FilePaths = impactFilePaths(v2Run, v2, allLocations);
    const v1FileCount = v1FilePaths.size;
    const v2FileCount = v2FilePaths.size;
    const fileDeltaRow = {
      target: publicLocation(targetLocation)!,
      v1ImpactedFiles: v1FileCount,
      v2ImpactedFiles: v2FileCount,
      delta: v2FileCount - v1FileCount,
      v1RiskLevel: computeRiskLevelFromCounts(v1FileCount, v1.nodesByKey.size),
      v2RiskLevel: computeRiskLevelFromCounts(v2FileCount, v2.nodesByKey.size),
    };
    fileBlastRadiusDeltaRows.push(fileDeltaRow);
    if (fileDeltaRow.delta < 0) {
      const v1IncomingRelations = v1.store.graph.getIncomingRelations(
        v1Target.id,
      );
      const v2IncomingRelations = v2.store.graph.getIncomingRelations(
        v2Target.id,
      );
      const countRelationTypes = (
        relations: typeof v1IncomingRelations,
      ): Record<string, number> => {
        const counts: Record<string, number> = {};
        for (const relation of relations) {
          counts[relation.linkType] = (counts[relation.linkType] ?? 0) + 1;
        }
        return counts;
      };
      const v1DirectCallers = callerKeys(v1, targetKey);
      const v2DirectCallers = callerKeys(v2, targetKey);
      worstFileLevelDropDetails.push({
        target: fileDeltaRow.target,
        delta: fileDeltaRow.delta,
        v1ImpactedFiles: v1FileCount,
        v2ImpactedFiles: v2FileCount,
        v1OnlyFilePaths: [...v1FilePaths]
          .filter((filePath) => !v2FilePaths.has(filePath))
          .sort(),
        v2OnlyFilePaths: [...v2FilePaths]
          .filter((filePath) => !v1FilePaths.has(filePath))
          .sort(),
        v1IncomingLinkTypeCounts: countRelationTypes(v1IncomingRelations),
        v2IncomingLinkTypeCounts: countRelationTypes(v2IncomingRelations),
        v1DirectCallerCount: v1DirectCallers.length,
        v2DirectCallerCount: v2DirectCallers.length,
        v1DirectCallerSample: v1DirectCallers.slice(0, 20),
        v2DirectCallerSample: v2DirectCallers.slice(0, 20),
      });
      worstFileLevelDropDetails.sort((left, right) => left.delta - right.delta);
      worstFileLevelDropDetails.splice(5);
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
    v2OnlyImpactAdditionEntries: v2OnlyImpactAdditions.length,
  };
  const additionCategoryCounts = Object.fromEntries(
    EXACT_CALLER_ADDITION_CATEGORIES.map((category) => [
      category,
      v2OnlyImpactAdditions.filter((addition) => addition.category === category)
        .length,
    ]),
  );
  return {
    repository,
    policies: {
      baseline: CallsProjectionCallerPolicies.SCOPE_RESOLVER_V1,
      candidate: CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
    },
    totals,
    additionCategoryCounts,
    v2OnlyImpactAdditions,
    fileBlastRadiusDeltaRows,
    worstFileLevelDropDetails,
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
