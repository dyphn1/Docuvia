import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
  createPortableCallSiteKey,
  isDiscoverableSourceFile,
  MAX_FILE_SIZE_BYTES,
  type CallResolutionHypothesisRequest,
  type CallResolutionHypothesisWorkspaceIndex,
  type CallResolutionHypothesisWorkspaceInput,
  type CallResolutionHypothesisResult,
  type CallResolutionStrictProof,
  type ICallResolutionHypothesisService,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { AstProcessingService } from "../../lib/core/src/ast/ast-processing.service.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import { GraphPersisterService } from "../../lib/core/src/graph/phase393-graph-persister.js";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import { GraphStore } from "../../lib/schema/src/index.js";
import { ScopeResolver } from "../../lib/core/src/graph/scope-resolver.js";
import {
  buildQualifiedBaseKey,
  buildUniqueNodeKey,
} from "../../lib/core/src/graph/node-key.js";
import { ANONYMOUS_SYMBOL_NAME } from "../../lib/core/src/constants/symbols.js";
import { equalStringMaps } from "./parity-utils.mts";

const Q3_RULES = new Set<string>([
  CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
]);
const CERTIFICATION_RULES = new Set<string>([
  ...Q3_RULES,
  "single-candidate-this-v1",
]);

type Q3ProvenProof = Extract<CallResolutionStrictProof, { status: "proven" }>;

function isQ3Proof(proof: CallResolutionStrictProof): proof is Q3ProvenProof {
  return proof.status === "proven" && Q3_RULES.has(proof.ruleSignature);
}

function parseOptions(argv: readonly string[]): {
  readonly snapshotRoot: string;
  readonly outputPath: string;
  readonly sitesOutputPath: string | null;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !["--snapshot-root", "--out", "--sites-out"].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        "Usage: phase3-q3-receiver-proof-whole-source-parity.mts --snapshot-root <HEAD archive> --out <summary.jsonl>",
      );
    values.set(key, value);
  }
  const snapshotRoot = values.get("--snapshot-root");
  const outputPath = values.get("--out");
  const sitesOutputPath = values.get("--sites-out");
  if (!snapshotRoot || !outputPath)
    throw new Error(
      "Usage: phase3-q3-receiver-proof-whole-source-parity.mts --snapshot-root <HEAD archive> --out <summary.jsonl>",
    );
  return {
    snapshotRoot: path.resolve(snapshotRoot),
    outputPath: path.resolve(outputPath),
    sitesOutputPath: sitesOutputPath ? path.resolve(sitesOutputPath) : null,
  };
}
type StableRow = Record<string, unknown>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function walkSourceFiles(root: string) {
  const files: Array<{ file: string; hash: string; code: string }> = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => right.name.localeCompare(left.name),
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const file = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (!isDiscoverableSourceFile(file)) continue;
      const fileStat = statSync(absolutePath);
      if (fileStat.size > MAX_FILE_SIZE_BYTES) continue;
      const bytes = readFileSync(absolutePath);
      files.push({ file, hash: sha256(bytes), code: bytes.toString("utf8") });
    }
  }
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

function canonicalRows(rows: readonly StableRow[]): string[] {
  return [...new Set(rows.map((row) => JSON.stringify(row)))].sort();
}

function diffRows(left: readonly string[], right: readonly string[]) {
  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();
  for (const row of left) leftCounts.set(row, (leftCounts.get(row) ?? 0) + 1);
  for (const row of right)
    rightCounts.set(row, (rightCounts.get(row) ?? 0) + 1);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [row, count] of leftCounts) {
    const delta = count - (rightCounts.get(row) ?? 0);
    for (let index = 0; index < delta; index++) removed.push(row);
  }
  for (const [row, count] of rightCounts) {
    const delta = count - (leftCounts.get(row) ?? 0);
    for (let index = 0; index < delta; index++) added.push(row);
  }
  return { removed: removed.sort(), added: added.sort() };
}

function portableKey(request: CallResolutionHypothesisRequest): string {
  return createPortableCallSiteKey({
    filePath: request.callerFilePath,
    sourceContentHash: request.callerSourceContentHash ?? "",
    startLine: request.callSite.startLine,
    startColumn: request.callSite.startColumn,
    calleeKind: request.callSite.calleeKind,
    calleeName: request.callSite.calleeName,
  });
}

function symbolsForLegacyProjection(
  result: ParsedAstFileResult,
): Map<string, string> {
  const usedKeys = new Set([result.file]);
  const symbols = new Map<string, string>();
  for (const fn of result.data.functions ?? []) {
    const nodeKey = buildUniqueNodeKey(
      usedKeys,
      buildQualifiedBaseKey(result.file, fn.name, fn.containerName),
      fn.startLine,
    );
    usedKeys.add(nodeKey);
    symbols.set(fn.name, nodeKey);
  }
  for (const cls of result.data.classes ?? []) {
    const nodeKey = buildUniqueNodeKey(
      usedKeys,
      `${result.file}#${cls.name}`,
      cls.startLine,
    );
    usedKeys.add(nodeKey);
    symbols.set(cls.name, nodeKey);
  }
  for (const variable of result.data.variables ?? []) {
    const nodeKey = buildUniqueNodeKey(
      usedKeys,
      `${result.file}#${variable.name}`,
      variable.startLine,
    );
    usedKeys.add(nodeKey);
    symbols.set(variable.name, nodeKey);
  }
  return symbols;
}

class TrackedHypothesisService implements ICallResolutionHypothesisService {
  readonly q3Sites = new Map<
    string,
    {
      targetKey: string;
      selected: string | null;
      callerFilePath: string;
      startLine: number;
      startColumn: number;
      calleeName: string;
      modulePath: string | null;
      targetFilePath: string;
      targetName: string;
      targetOwnerName: string;
      ruleSignature: string;
      callerTypeName: string | null;
    }
  >();
  readonly nonQ3Results = new Map<string, string>();
  readonly q3HeuristicOutputs = new Map<string, string>();
  readonly importProofAbstentionCounts = new Map<string, number>();
  readonly q3AbstentionExamples: Array<Record<string, unknown>> = [];
  readonly importCallCount = { value: 0 };
  sourceFiles: CallResolutionHypothesisWorkspaceInput["sourceFiles"] = [];
  readonly delegate = new CallResolutionHypothesisService();

  constructor(private readonly suppressQ3: boolean) {}

  indexWorkspace(
    input: CallResolutionHypothesisWorkspaceInput,
  ): CallResolutionHypothesisWorkspaceIndex {
    this.sourceFiles = input.sourceFiles;
    return this.delegate.indexWorkspace(input);
  }

  hypothesize(
    request: CallResolutionHypothesisRequest,
  ): CallResolutionHypothesisResult {
    const result = this.delegate.hypothesize(request);
    if (request.callSite.calleeBinding?.kind === "import") {
      this.importCallCount.value++;
      if (result.strictProof.status === "abstained") {
        const reason = result.strictProof.reason;
        this.importProofAbstentionCounts.set(
          reason,
          (this.importProofAbstentionCounts.get(reason) ?? 0) + 1,
        );
        if (this.q3AbstentionExamples.length < 20) {
          const caller = this.sourceFiles.find(
            (file) => file.filePath === request.callerFilePath,
          );
          const descriptor = caller?.imports?.find(
            (item) => item.localName === request.callSite.calleeName,
          );
          this.q3AbstentionExamples.push({
            caller: request.callerFilePath,
            line: request.callSite.startLine,
            column: request.callSite.startColumn,
            calleeName: request.callSite.calleeName,
            modulePath: descriptor?.modulePath ?? null,
            reason,
          });
        }
      }
    }
    const key = portableKey(request);
    if (isQ3Proof(result.strictProof)) {
      this.q3Sites.set(key, {
        targetKey: result.strictProof.targetKey,
        selected: result.selected?.targetKey ?? null,
        callerFilePath: request.callerFilePath,
        startLine: request.callSite.startLine,
        startColumn: request.callSite.startColumn,
        calleeName: request.callSite.calleeName,
        modulePath:
          this.sourceFiles
            .find((source) => source.filePath === request.callerFilePath)
            ?.imports?.find(
              (descriptor) =>
                descriptor.localName === request.callSite.calleeName,
            )?.modulePath ?? null,
        targetFilePath: result.strictProof.targetFilePath,
        targetName: result.strictProof.targetName,
        targetOwnerName: result.strictProof.targetOwnerName,
        ruleSignature: result.strictProof.ruleSignature,
        callerTypeName: request.callSite.callerType?.name ?? null,
      });
      const { strictProof: _strictProof, ...heuristicOutput } = result;
      this.q3HeuristicOutputs.set(key, JSON.stringify(heuristicOutput));
      if (!this.suppressQ3) return result;
      return {
        ...result,
        strictProof: {
          status: "abstained",
          targetKey: null,
          ruleSignature: null,
          reason: "unresolved-type-binding",
        },
      };
    }
    this.nonQ3Results.set(key, JSON.stringify(result));
    return result;
  }
}

type Projection = {
  nodes: string[];
  links: string[];
  calls: string[];
  nonCalls: string[];
  persistedQ3: Array<{
    callSiteKey: string;
    callerNodeKey: string;
    targetNodeKey: string;
    filePath: string;
    startLine: number;
    startColumn: number;
    calleeName: string;
  }>;
  certificationProofs: Array<{
    callSiteKey: string;
    filePath: string;
    startLine: number;
    startColumn: number;
    calleeName: string;
    targetNodeKey: string;
    ruleSignature: string;
  }>;
  q3Sites: TrackedHypothesisService["q3Sites"];
  nonQ3Results: Map<string, string>;
  q3HeuristicOutputs: Map<string, string>;
  importProofAbstentionCounts: Record<string, number>;
  q3AbstentionExamples: Array<Record<string, unknown>>;
  importCallCount: number;
  missingQ3PersistenceCounts: Record<string, number>;
  missingQ3PersistenceExamples: Array<Record<string, unknown>>;
};

async function persistProjection(
  snapshotRoot: string,
  databasePath: string,
  projectionName: string,
  parsedResults: ParsedAstFileResult[],
  suppressQ3: boolean,
): Promise<Projection> {
  const service = new TrackedHypothesisService(suppressQ3);
  const store = await GraphStore.open({ dbPath: databasePath });
  try {
    const projectId = store.projects.insert({
      name: `q3-parity-${projectionName}`,
      repoUrl: `file:///${projectionName}`,
    }).id;
    await new GraphPersisterService(service).persist({
      store,
      workspaceRoot: snapshotRoot,
      projectId,
      parsedResults,
      sourceIndexComplete: true,
      tags: [],
    });

    const nodes = store.graph.getAllNodes();
    const nodeKeyById = new Map(nodes.map((node) => [node.id, node.node_key]));
    const links = store.graph.getAllLinks().map((link) => {
      const {
        id: _id,
        source_node_id: _sourceId,
        target_node_id: _targetId,
        created_at: _created,
        ...stable
      } = link;
      return {
        ...stable,
        source_node_key: nodeKeyById.get(link.source_node_id),
        target_node_key: nodeKeyById.get(link.target_node_id),
      };
    });
    const persistedQ3 = parsedResults.flatMap((result) =>
      store.callSiteResolutions
        .getForFile(projectId, result.file)
        .filter((row) => Q3_RULES.has(row.ruleSignature))
        .map((row) => ({
          callSiteKey: row.callSiteKey,
          callerNodeKey: row.callerNodeKey,
          targetNodeKey: row.selectedTargetNodeKey!,
          filePath: row.filePath,
          startLine: row.startLine,
          startColumn: row.startColumn,
          calleeName: row.calleeName,
        })),
    );
    const certificationProofs = parsedResults.flatMap((result) =>
      store.callSiteResolutions
        .getForFile(projectId, result.file)
        .filter((row) => CERTIFICATION_RULES.has(row.ruleSignature))
        .map((row) => ({
          callSiteKey: row.callSiteKey,
          filePath: row.filePath,
          startLine: row.startLine,
          startColumn: row.startColumn,
          calleeName: row.calleeName,
          targetNodeKey: row.selectedTargetNodeKey!,
          ruleSignature: row.ruleSignature,
        })),
    );
    const persistedKeys = new Set(persistedQ3.map((row) => row.callSiteKey));
    const missingQ3Persistence = [...service.q3Sites.entries()]
      .filter(([key]) => !persistedKeys.has(key))
      .map(([, site]) => {
        const caller = parsedResults.find(
          (result) => result.file === site.callerFilePath,
        );
        const calls = caller?.data.calls ?? [];
        const callMatches = calls.filter(
          (call) =>
            call.startLine === site.startLine &&
            call.startColumn === site.startColumn &&
            call.calleeName === site.calleeName,
        );
        const call = callMatches[0];
        const functions = caller?.data.functions ?? [];
        const enclosing = functions.filter(
          (fn) =>
            fn.startLine <= site.startLine && fn.endLine >= site.startLine,
        );
        const callerMatches = functions.filter(
          (fn) =>
            fn.name === call?.sourceFunction &&
            fn.containerName === site.callerTypeName &&
            fn.startLine <= site.startLine &&
            fn.endLine >= site.startLine,
        );
        const targetFile = parsedResults.find(
          (result) => result.file === site.targetFilePath,
        );
        const targetMatches = (targetFile?.data.functions ?? []).filter(
          (fn) =>
            fn.name === site.targetName &&
            fn.containerName === site.targetOwnerName,
        );
        return {
          callerFilePath: site.callerFilePath,
          line: site.startLine,
          callee: site.calleeName,
          callMatches: callMatches.length,
          sourceFunction: call?.sourceFunction ?? null,
          enclosingFunctionCount: enclosing.length,
          callerMatchCount: callerMatches.length,
          targetFilePath: site.targetFilePath,
          targetFunctionMatches: targetMatches.length,
          cause:
            !call || callMatches.length !== 1
              ? "no-unique-parsed-call"
              : targetMatches.length !== 1
                ? "target-function-node-missing-or-ambiguous"
                : enclosing.length > 0 && callerMatches.length !== 1
                  ? "caller-function-node-missing-or-ambiguous"
                  : "unclassified",
        };
      });
    const missingQ3PersistenceCounts = Object.fromEntries([
      ...missingQ3Persistence.reduce(
        (counts, row) =>
          counts.set(row.cause, (counts.get(row.cause) ?? 0) + 1),
        new Map<string, number>(),
      ),
    ]);
    return {
      missingQ3PersistenceCounts,
      missingQ3PersistenceExamples: missingQ3Persistence.slice(0, 30),
      nodes: canonicalRows(
        nodes.map((node) => {
          const {
            id: _id,
            created_at: _created,
            last_verified_at: _verified,
            updated_at: _updated,
            ...stable
          } = node;
          return stable;
        }),
      ),
      links: canonicalRows(links),
      calls: canonicalRows(links.filter((link) => link.link_type === "calls")),
      nonCalls: canonicalRows(
        links.filter((link) => link.link_type !== "calls"),
      ),
      persistedQ3,
      certificationProofs,
      q3Sites: service.q3Sites,
      nonQ3Results: service.nonQ3Results,
      q3HeuristicOutputs: service.q3HeuristicOutputs,
      importProofAbstentionCounts: Object.fromEntries(
        service.importProofAbstentionCounts,
      ),
      q3AbstentionExamples: service.q3AbstentionExamples,
      importCallCount: service.importCallCount.value,
      missingQ3PersistenceCounts,
      missingQ3PersistenceExamples: missingQ3Persistence.slice(0, 30),
    };
  } finally {
    await store.close();
  }
}

async function main() {
  const { snapshotRoot, outputPath, sitesOutputPath } = parseOptions(
    process.argv.slice(2),
  );
  const discoveredFiles = walkSourceFiles(snapshotRoot);
  const pool = new AstWorkerPool();
  const processor = new AstProcessingService({
    initialize: async () => pool.initialize(2),
    parse: (request) => pool.parse(request),
    terminate: () => pool.terminate(),
    serializeBatch: (fn) => fn(),
  });
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 250);
  sampler.unref();
  const parsed = await processor.processFiles(snapshotRoot, discoveredFiles);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (parsed.failures.length > 0)
    throw new Error(`parse failures: ${parsed.failures.length}`);
  const incompleteProgramDeclarations = parsed.parsed.flatMap((row) => {
    const declarations = row.data.declaredTypeFacts?.declarations ?? [];
    return declarations
      .filter(
        (declaration) =>
          declaration.owner.kind === "program" &&
          (declaration.kind === "unknown" ||
            declaration.unsupportedReason !== undefined),
      )
      .map((declaration) => ({
        filePath: row.file,
        kind: declaration.kind,
        name: declaration.name,
        unsupportedReason: declaration.unsupportedReason,
      }));
  });
  const sourceInventoryDiagnostics = {
    parsedFilesMissingDeclaredTypeFacts: parsed.parsed.filter(
      (row) => !row.data.declaredTypeFacts,
    ).length,
    parsedFilesWithInvalidFactSchema: parsed.parsed.filter(
      (row) => row.data.declaredTypeFacts?.schemaVersion !== 1,
    ).length,
    filesMissingValidHash: parsed.parsed.filter(
      (row) => !/^[a-f0-9]{64}$/u.test(row.hash),
    ).length,
    incompleteProgramDeclarations: incompleteProgramDeclarations.length,
    incompleteProgramDeclarationExamples: incompleteProgramDeclarations.slice(
      0,
      20,
    ),
  };

  const dbRoot = mkdtempSync(path.join(os.tmpdir(), "docuvia-q3-parity-db-"));
  let baseline: Projection;
  let working: Projection;
  try {
    baseline = await persistProjection(
      snapshotRoot,
      path.join(dbRoot, "baseline.db"),
      "q3-suppressed",
      parsed.parsed,
      true,
    );
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    working = await persistProjection(
      snapshotRoot,
      path.join(dbRoot, "working.db"),
      "q3-enabled",
      parsed.parsed,
      false,
    );
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  } finally {
    rmSync(dbRoot, { recursive: true, force: true });
    clearInterval(sampler);
  }

  const nodeDiff = diffRows(baseline.nodes, working.nodes);
  const callDiff = diffRows(
    [...new Set(baseline.calls)],
    [...new Set(working.calls)],
  );
  const nonCallDiff = diffRows(baseline.nonCalls, working.nonCalls);
  const fullLinkDiff = diffRows(baseline.links, working.links);
  const baselineQ3Keys = [...baseline.q3Sites.keys()].sort();
  const workingQ3Keys = [...working.q3Sites.keys()].sort();
  const persistedQ3Keys = working.persistedQ3
    .map((row) => row.callSiteKey)
    .sort();
  const parsedByFile = new Map(
    parsed.parsed.map((result) => [result.file, result]),
  );
  const symbolMapsByFile = new Map(
    parsed.parsed.map((result) => [
      result.file,
      symbolsForLegacyProjection(result),
    ]),
  );
  const resolver = new ScopeResolver(snapshotRoot);
  for (const result of parsed.parsed) {
    const locals = [
      ...(result.data.functions ?? []).map((fn) => fn.name),
      ...(result.data.classes ?? []).map((cls) => cls.name),
      ...(result.data.variables ?? []).map((variable) => variable.name),
    ];
    resolver.registerFile(
      result.file,
      (result.data.imports ?? []).filter(
        (descriptor) => !descriptor.isCombinedDefaultImport,
      ),
      [],
      locals,
    );
  }
  const q3SiteProjectionEdges = [...working.q3Sites.entries()].flatMap(
    ([callSiteKey, site]) => {
      const callerResult = parsedByFile.get(site.callerFilePath);
      const call = callerResult?.data.calls?.find(
        (candidate) =>
          candidate.startLine === site.startLine &&
          candidate.startColumn === site.startColumn &&
          candidate.calleeName === site.calleeName,
      );
      const persisted = working.persistedQ3.find(
        (row) => row.callSiteKey === callSiteKey,
      );
      if (!callerResult || !call || !persisted) return [];
      const oldSource =
        call.sourceFunction && call.sourceFunction !== ANONYMOUS_SYMBOL_NAME
          ? (symbolMapsByFile
              .get(site.callerFilePath)
              ?.get(call.sourceFunction) ?? site.callerFilePath)
          : site.callerFilePath;
      const scopeTarget =
        (call.calleeKind === "member" || call.calleeKind === "this") &&
        call.receiverText
          ? resolver.resolveMemberCall(
              site.callerFilePath,
              call.receiverText,
              call.calleeName,
            )
          : resolver.resolveCall(site.callerFilePath, call.targetFunction);
      const oldTarget = scopeTarget
        ? (symbolMapsByFile
            .get(scopeTarget.targetFile)
            ?.get(scopeTarget.targetSymbol) ??
          (parsedByFile.has(scopeTarget.targetFile)
            ? scopeTarget.targetFile
            : null))
        : null;
      // ScopeResolver keeps the caller attribution; Q3 supplies only the target.
      const newSource = oldSource;
      const newTarget = persisted.targetNodeKey;
      return [
        {
          callSiteKey,
          filePath: site.callerFilePath,
          startLine: site.startLine,
          startColumn: site.startColumn,
          calleeName: site.calleeName,
          ruleSignature: site.ruleSignature,
          strictTarget: site.strictTarget,
          scopeResolverSourceNodeKey: oldSource,
          scopeResolverTargetNodeKey: oldTarget,
          provenSourceNodeKey: newSource,
          provenTargetNodeKey: newTarget,
          fullEdgeChanged: oldSource !== newSource || oldTarget !== newTarget,
          callerNodeChanged: oldSource !== newSource,
          targetNodeChanged: oldTarget !== newTarget,
        },
      ];
    },
  );
  const callsLinkDiffs = [
    ...callDiff.added.map((row) => ({ direction: "added" as const, row })),
    ...callDiff.removed.map((row) => ({ direction: "removed" as const, row })),
  ].map(({ direction, row }) => {
    const edge = JSON.parse(row) as {
      source_node_key: string;
      target_node_key: string;
      link_type: string;
    };
    const proofSites = q3SiteProjectionEdges
      .filter((site) =>
        direction === "added"
          ? site.provenSourceNodeKey === edge.source_node_key &&
            site.provenTargetNodeKey === edge.target_node_key &&
            site.fullEdgeChanged
          : site.scopeResolverSourceNodeKey === edge.source_node_key &&
            site.scopeResolverTargetNodeKey === edge.target_node_key &&
            site.fullEdgeChanged,
      )
      .map((site) => ({
        filePath: site.filePath,
        startLine: site.startLine,
        startColumn: site.startColumn,
        calleeName: site.calleeName,
        ruleSignature: site.ruleSignature,
        strictTarget: site.strictTarget,
        scopeResolverEdge:
          site.scopeResolverSourceNodeKey && site.scopeResolverTargetNodeKey
            ? `${site.scopeResolverSourceNodeKey} -> ${site.scopeResolverTargetNodeKey}`
            : null,
        provenEdge: `${site.provenSourceNodeKey} -> ${site.provenTargetNodeKey}`,
        callerNodeChanged: site.callerNodeChanged,
        targetNodeChanged: site.targetNodeChanged,
      }));
    const reasons = new Set(
      proofSites.map((site) =>
        site.scopeResolverEdge === null
          ? "The call had no local ScopeResolver target edge; Q3 adds the proven caller-to-target edge."
          : site.callerNodeChanged && site.targetNodeChanged
            ? "Q3 changes both the exact enclosing caller node and the target from the ScopeResolver projection."
            : site.callerNodeChanged
              ? "Q3 attaches the same target to the exact enclosing caller node instead of the ScopeResolver source node."
              : "Q3 replaces the ScopeResolver target with the strict receiver target.",
      ),
    );
    return {
      direction,
      sourceNodeKey: edge.source_node_key,
      targetNodeKey: edge.target_node_key,
      linkType: edge.link_type,
      justification: [...reasons].join(" "),
      proofSiteCount: proofSites.length,
      proofSite: proofSites[0] ?? null,
      proofSites,
      wrongTargetReplacement:
        direction === "removed" &&
        proofSites.length > 0 &&
        proofSites.every(
          (site) =>
            site.scopeResolverEdge !== null &&
            site.scopeResolverEdge !== site.provenEdge &&
            site.callerNodeChanged === false &&
            site.targetNodeChanged === true,
        ),
    };
  });
  const everyCallDiffHasQ3Explanation = callsLinkDiffs.every(
    (row) =>
      row.proofSiteCount > 0 &&
      row.proofSites.every((site) => site.callerNodeChanged === false),
  );
  const everyRemovedCallLinkReplacesWrongTarget = callsLinkDiffs
    .filter((row) => row.direction === "removed")
    .every((row) => row.wrongTargetReplacement);
  const q3HeuristicOutputsSame = equalStringMaps(
    baseline.q3HeuristicOutputs,
    working.q3HeuristicOutputs,
  );
  const nonQ3HypothesesSame = equalStringMaps(
    baseline.nonQ3Results,
    working.nonQ3Results,
  );
  const replacedTargets = q3SiteProjectionEdges
    .filter(
      (site) =>
        site.scopeResolverTargetNodeKey !== null && site.targetNodeChanged,
    )
    .map((site) => ({
      filePath: site.filePath,
      line: site.startLine,
      column: site.startColumn,
      calleeName: site.calleeName,
      ruleSignature: site.ruleSignature,
      strictTarget: site.strictTarget,
      scopeResolverTargetNodeKey: site.scopeResolverTargetNodeKey,
      q3TargetNodeKey: site.provenTargetNodeKey,
    }));
  const q3ProofCountsByRule = Object.fromEntries(
    [...Q3_RULES].map((ruleSignature) => [
      ruleSignature,
      workingQ3Keys.filter(
        (key) => working.q3Sites.get(key)?.ruleSignature === ruleSignature,
      ).length,
    ]),
  );
  const summary = {
    comparison:
      "same committed HEAD source snapshot parsed once; Q3 proven proofs suppressed in baseline, enabled in working projection",
    callsProjectionCallerPolicy:
      "ScopeResolver caller attribution is retained for every call site; Q3 proven rows replace only the target and retain the exact enclosing caller separately in the resolution record",
    callsProjectionComparison:
      "unique (source_node_key, target_node_key, link_type) tuples, matching the collapsed calls projection contract",
    sourceFiles: discoveredFiles.length,
    parsedFiles: parsed.parsed.length,
    parseFailures: parsed.failures.length,
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    q3ServiceProofSites: workingQ3Keys.length,
    q3ImportBoundCallSites: working.importCallCount,
    importProofAbstentionCounts: working.importProofAbstentionCounts,
    q3AbstentionExamples: working.q3AbstentionExamples,
    sourceInventoryDiagnostics,
    q3PersistedResolutionRows: persistedQ3Keys.length,
    missingQ3PersistenceCounts: working.missingQ3PersistenceCounts,
    missingQ3PersistenceExamples: working.missingQ3PersistenceExamples,
    suppressedAndEnabledQ3SetMatches:
      JSON.stringify(baselineQ3Keys) === JSON.stringify(workingQ3Keys),
    allQ3ServiceProofsPersisted:
      JSON.stringify(workingQ3Keys) === JSON.stringify(persistedQ3Keys),
    q3ProofCountsByRule,
    q3SitesWithHeuristicSelection: [...working.q3Sites.values()].filter(
      (site) => site.selected !== null,
    ).length,
    nodesUnchanged:
      nodeDiff.added.length === 0 && nodeDiff.removed.length === 0,
    nonCallLinksUnchanged:
      nonCallDiff.added.length === 0 && nonCallDiff.removed.length === 0,
    callLinksChangedOnlyForQ3Sites: everyCallDiffHasQ3Explanation,
    zeroCallerOnlyChanges:
      everyCallDiffHasQ3Explanation &&
      q3SiteProjectionEdges.every((site) => !site.callerNodeChanged),
    everyRemovedCallLinkReplacesWrongTarget,
    q3SitesWithScopeResolverEdge: q3SiteProjectionEdges.filter(
      (site) => site.scopeResolverTargetNodeKey !== null,
    ).length,
    q3SitesWithCallerNodeChange: q3SiteProjectionEdges.filter(
      (site) => site.callerNodeChanged,
    ).length,
    q3SitesWithTargetNodeChange: q3SiteProjectionEdges.filter(
      (site) => site.targetNodeChanged,
    ).length,
    q3SitesWithProjectionChange: q3SiteProjectionEdges.filter(
      (site) => site.fullEdgeChanged,
    ).length,
    q3SitesWithUnchangedProjection: q3SiteProjectionEdges.filter(
      (site) => !site.fullEdgeChanged,
    ).length,
    q3ProvenExamples: replacedTargets.slice(0, 30),
    replacedTargetCount: replacedTargets.length,
    q3HeuristicOutputsUnchanged: q3HeuristicOutputsSame,
    nonQ3HypothesisOutputsUnchanged: nonQ3HypothesesSame,
    changedCallLinks: {
      added: callDiff.added.length,
      removed: callDiff.removed.length,
    },
    callsLinkDiffs,
    allLinksChanged: {
      added: fullLinkDiff.added.length,
      removed: fullLinkDiff.removed.length,
    },
    calibrationPromotions: 0,
    peakRssBytes: peakRss,
  };
  const sourceManifestSha256 = sha256(
    JSON.stringify(discoveredFiles.map(({ file, hash }) => ({ file, hash }))),
  );
  const summaryRow = Object.fromEntries(
    Object.entries(summary).filter(([key]) => key !== "callsLinkDiffs"),
  );
  const artifactRows = [
    JSON.stringify({
      type: "summary",
      schemaVersion: 1,
      sourceManifestSha256,
      ...summaryRow,
    }),
    ...callsLinkDiffs.map((difference) =>
      JSON.stringify({ type: "calls-link-diff", ...difference }),
    ),
  ];
  writeFileSync(outputPath, `${artifactRows.join("\n")}\n`, "utf8");
  if (sitesOutputPath)
    writeFileSync(
      sitesOutputPath,
      `${JSON.stringify(working.certificationProofs)}\n`,
      "utf8",
    );
  process.stdout.write(
    `${JSON.stringify({ outputPath, sourceManifestSha256, ...summaryRow }, null, 2)}\n`,
  );
  if (peakRss >= 6 * 1024 ** 3) throw new Error("RSS exceeded 6 GiB");
  if (
    !summary.nodesUnchanged ||
    !summary.nonCallLinksUnchanged ||
    !everyCallDiffHasQ3Explanation ||
    !summary.everyRemovedCallLinkReplacesWrongTarget ||
    !summary.zeroCallerOnlyChanges ||
    !summary.nonQ3HypothesisOutputsUnchanged ||
    !summary.q3HeuristicOutputsUnchanged ||
    !summary.suppressedAndEnabledQ3SetMatches ||
    !summary.allQ3ServiceProofsPersisted
  ) {
    throw new Error("Q3 whole-source parity invariant failed");
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
