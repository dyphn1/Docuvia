import * as path from "path";
import {
  LinkTypes,
  type IGraphPersister,
  type IGraphStore,
  type ParsedAstFileResult,
} from "@workspace/contracts";
import { GraphPersisterService as BaseGraphPersisterService } from "./persist-ast-graph.js";
import { ScopeResolver } from "./scope-resolver.js";
import { readFileWithinRoot } from "../utils/safe-fs.js";

const CHILD_PROCESS_MODULES = new Set(["child_process", "node:child_process"]);
const CHILD_PROCESS_FILE_APIS = new Set([
  "execFile",
  "execFileSync",
  "spawn",
  "spawnSync",
  "fork",
]);
const PROJECT_FILE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;
const COMPILED_JS_EXTENSION = /\.(?:js|jsx|mjs|cjs)$/;
const WILDCARD_IMPORT = "*";

type ImportDescriptor = NonNullable<
  ParsedAstFileResult["data"]["imports"]
>[number];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localSymbols(result: ParsedAstFileResult): string[] {
  return [
    ...(result.data.functions ?? []).map((item) => item.name),
    ...(result.data.classes ?? []).map((item) => item.name),
    ...(result.data.variables ?? []).map((item) => item.name),
  ];
}

/**
 * Phase 6 correctness layer around the existing graph persister.
 *
 * The base persister remains the source of truth for symbol/call/extends/implements/re-export
 * graph construction. This wrapper adds only two dependencies that are statically provable but
 * historically invisible to impact analysis (#192):
 *
 * 1. imported values that are never called (`import { FLAG } ...; if (FLAG) ...`), and
 * 2. literal project-file execution through `child_process` (`execFile("node", ["x.js"])`).
 *
 * Dynamic paths are deliberately ignored here. They belong to #393's lower-bound/UNKNOWN model;
 * guessing them would trade an honest false negative for a false positive.
 */
export class GraphPersisterService implements IGraphPersister {
  private readonly base = new BaseGraphPersisterService();

  public async persist(
    input: Parameters<IGraphPersister["persist"]>[0],
  ): Promise<Awaited<ReturnType<IGraphPersister["persist"]>>> {
    const result = await this.base.persist(input);

    await input.store.withWriteLock(() =>
      input.store.withTransaction(() => {
        this.linkValueImports(
          input.store,
          input.workspaceRoot,
          input.parsedResults,
        );
        this.linkLiteralChildProcesses(
          input.store,
          input.workspaceRoot,
          input.parsedResults,
        );
      }),
    );

    return result;
  }

  /**
   * A named import is itself a compile/runtime dependency even when no call site references it.
   * Calls/extends/implements already carry a more specific edge, so skip those and only add the
   * missing value-import relationship. This prevents one real dependency from inflating impact
   * risk through both a file-level IMPORTS edge and a symbol-level CALLS edge.
   */
  private linkValueImports(
    store: IGraphStore,
    workspaceRoot: string,
    parsedResults: ParsedAstFileResult[],
  ): void {
    const resolver = this.createScopeResolver(workspaceRoot, parsedResults);
    for (const result of parsedResults) {
      this.linkValueImportsForFile(store, resolver, result);
    }
  }

  private createScopeResolver(
    workspaceRoot: string,
    parsedResults: ParsedAstFileResult[],
  ): ScopeResolver {
    const resolver = new ScopeResolver(workspaceRoot);
    for (const result of parsedResults) {
      resolver.registerFile(
        result.file,
        result.data.imports ?? [],
        [],
        localSymbols(result),
      );
    }
    return resolver;
  }

  private linkValueImportsForFile(
    store: IGraphStore,
    resolver: ScopeResolver,
    result: ParsedAstFileResult,
  ): void {
    const sourceId = store.graph.findNodeIdByName(result.file, result.file);
    if (!sourceId) return;

    for (const descriptor of result.data.imports ?? []) {
      this.linkValueImport(store, resolver, result, sourceId, descriptor);
    }
  }

  private linkValueImport(
    store: IGraphStore,
    resolver: ScopeResolver,
    result: ParsedAstFileResult,
    sourceId: number,
    descriptor: ImportDescriptor,
  ): void {
    if (descriptor.viaReexport) return;
    if (this.hasStrongerSymbolRelationship(result, descriptor.localName))
      return;

    const resolved = resolver.resolveCall(result.file, descriptor.localName);
    if (!resolved) return;
    const targetId =
      store.graph.findNodeIdByName(
        resolved.targetFile,
        resolved.targetSymbol,
      ) ??
      store.graph.findNodeIdByName(resolved.targetFile, resolved.targetFile);
    if (!targetId || targetId === sourceId) return;
    this.insertLinkOnce(store, sourceId, targetId, LinkTypes.IMPORTS);
  }

  private hasStrongerSymbolRelationship(
    result: ParsedAstFileResult,
    localName: string,
  ): boolean {
    return (
      (result.data.calls ?? []).some(
        (call) =>
          call.calleeName === localName || call.targetFunction === localName,
      ) ||
      (result.data.implements ?? []).some(
        (edge) => edge.targetInterface === localName,
      ) ||
      (result.data.extends ?? []).some((edge) => edge.targetClass === localName)
    );
  }

  /**
   * Precision-first child-process handling. Only direct imported APIs and literal script paths
   * are accepted. `exec`, shell command strings, variables, concatenation and template literals
   * intentionally remain unresolved (#393).
   */
  private linkLiteralChildProcesses(
    store: IGraphStore,
    workspaceRoot: string,
    parsedResults: ParsedAstFileResult[],
  ): void {
    const parsedFiles = new Set(parsedResults.map((result) => result.file));
    for (const result of parsedResults) {
      this.linkLiteralChildProcessesForFile(
        store,
        workspaceRoot,
        parsedFiles,
        result,
      );
    }
  }

  private linkLiteralChildProcessesForFile(
    store: IGraphStore,
    workspaceRoot: string,
    parsedFiles: ReadonlySet<string>,
    result: ParsedAstFileResult,
  ): void {
    const source = readFileWithinRoot(workspaceRoot, result.file);
    if (!source) return;
    const sourceId = store.graph.findNodeIdByName(result.file, result.file);
    if (!sourceId) return;

    for (const descriptor of result.data.imports ?? []) {
      if (CHILD_PROCESS_MODULES.has(descriptor.modulePath)) {
        this.linkChildProcessDescriptor(
          store,
          parsedFiles,
          result.file,
          sourceId,
          source,
          descriptor,
        );
      }
    }
  }

  private linkChildProcessDescriptor(
    store: IGraphStore,
    parsedFiles: ReadonlySet<string>,
    sourceFile: string,
    sourceId: number,
    source: string,
    descriptor: ImportDescriptor,
  ): void {
    for (const invocation of this.childProcessInvocations(descriptor)) {
      const targets = this.extractLiteralProcessTargets(
        source,
        invocation.localExpression,
        invocation.api,
      );
      for (const targetPath of targets) {
        this.linkResolvedProcessTarget(
          store,
          parsedFiles,
          sourceFile,
          sourceId,
          targetPath,
        );
      }
    }
  }

  private linkResolvedProcessTarget(
    store: IGraphStore,
    parsedFiles: ReadonlySet<string>,
    sourceFile: string,
    sourceId: number,
    targetPath: string,
  ): void {
    const targetFile = this.resolveProjectFile(
      sourceFile,
      targetPath,
      parsedFiles,
    );
    if (!targetFile) return;
    const targetId = store.graph.findNodeIdByName(targetFile, targetFile);
    if (!targetId || targetId === sourceId) return;
    this.insertLinkOnce(store, sourceId, targetId, LinkTypes.DEPENDS_ON);
  }

  private childProcessInvocations(
    descriptor: ImportDescriptor,
  ): Array<{ api: string; localExpression: string }> {
    if (
      CHILD_PROCESS_FILE_APIS.has(descriptor.originalName) &&
      descriptor.originalName !== WILDCARD_IMPORT
    ) {
      return [
        { api: descriptor.originalName, localExpression: descriptor.localName },
      ];
    }
    if (descriptor.originalName === WILDCARD_IMPORT) {
      return [...CHILD_PROCESS_FILE_APIS].map((api) => ({
        api,
        localExpression: `${descriptor.localName}.${api}`,
      }));
    }
    return [];
  }

  private extractLiteralProcessTargets(
    source: string,
    localExpression: string,
    api: string,
  ): string[] {
    const callee = escapeRegExp(localExpression);
    const pattern =
      api === "fork"
        ? new RegExp(`\\b${callee}\\s*\\(\\s*["']([^"']+)["']`, "g")
        : new RegExp(
            `\\b${callee}\\s*\\(\\s*(?:["']node(?:\\.exe)?["']|process\\.execPath)\\s*,\\s*\\[\\s*["']([^"']+)["']`,
            "g",
          );
    return [...source.matchAll(pattern)].map((match) => match[1]);
  }

  private resolveProjectFile(
    sourceFile: string,
    rawTarget: string,
    parsedFiles: ReadonlySet<string>,
  ): string | undefined {
    const normalizedTarget = rawTarget.replace(/\\/g, "/");
    const candidates = new Set<string>();
    if (
      normalizedTarget.startsWith("./") ||
      normalizedTarget.startsWith("../")
    ) {
      candidates.add(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(sourceFile), normalizedTarget),
        ),
      );
    }
    candidates.add(path.posix.normalize(normalizedTarget.replace(/^\//, "")));

    for (const candidate of candidates) {
      if (parsedFiles.has(candidate)) return candidate;
      if (COMPILED_JS_EXTENSION.test(candidate)) {
        const stem = candidate.replace(COMPILED_JS_EXTENSION, "");
        for (const extension of PROJECT_FILE_EXTENSIONS) {
          const swapped = `${stem}${extension}`;
          if (parsedFiles.has(swapped)) return swapped;
        }
      } else {
        for (const extension of PROJECT_FILE_EXTENSIONS) {
          const withExtension = `${candidate}${extension}`;
          if (parsedFiles.has(withExtension)) return withExtension;
        }
      }
    }
    return undefined;
  }

  private insertLinkOnce(
    store: IGraphStore,
    sourceNodeId: number,
    targetNodeId: number,
    linkType: string,
  ): void {
    const exists = store.graph
      .getOutgoingRelations(sourceNodeId)
      .some(
        (relation) =>
          relation.id === targetNodeId && relation.linkType === linkType,
      );
    if (!exists) {
      store.graph.insertLink({ sourceNodeId, targetNodeId, linkType });
    }
  }
}
