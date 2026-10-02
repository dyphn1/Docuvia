/** Snapshot I/O and TypeScript module resolution for the pure System-1 parser. */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import {
  DefaultProvider,
  typescriptConfig,
} from "../../lib/ast-core/src/index.js";
import type { Parser as TreeSitterParser } from "web-tree-sitter";
import {
  extractTierAIndexedDeclarations,
  type TierAIndexedDeclaration,
} from "../../lib/core/src/ast/tier-a-declaration-index.js";
import { resolveWasmPath } from "../../lib/core/src/ast/resolve-wasm-path.js";
import {
  System1SnapshotSyntax as CoreSystem1SnapshotSyntax,
  type System1SyntaxEnvironment,
} from "../../lib/core/src/semantic/system1/system1-syntax.js";
import { parseSystem1ProjectOptions } from "../../lib/core/src/semantic/system1/system1-tsconfig.js";
import type { System1ProjectOptions } from "../../lib/core/src/semantic/system1/system1-tsconfig.js";
import type {
  SemanticCollectionCallSite,
  SemanticCollectionGraphNode,
  SemanticTierACandidateSet,
} from "../../lib/contracts/src/index.js";
import type { System1CandidateInput } from "../../lib/core/src/semantic/system1/system1-types.js";

export type {
  System1SyntaxFailure,
  System1SyntaxResult,
  TierACandidateSyntaxInput,
} from "../../lib/core/src/semantic/system1/system1-syntax.js";

const SOURCE_FILE_NOT_FOUND_CODE = "ENOENT";
const TREE_SITTER_ESM_ENTRY = "tree-sitter.js";
const AST_CORE_REQUIRE = createRequire(
  path.resolve(import.meta.dirname, "../../lib/ast-core/package.json"),
);
let tierATreeSitterModulePromise: Promise<
  typeof import("web-tree-sitter")
> | null = null;

function getTierATreeSitterModule(): Promise<typeof import("web-tree-sitter")> {
  if (!tierATreeSitterModulePromise) {
    const packageEntry = AST_CORE_REQUIRE.resolve("web-tree-sitter");
    const esmEntry = path.join(
      path.dirname(packageEntry),
      TREE_SITTER_ESM_ENTRY,
    );
    tierATreeSitterModulePromise = import(
      pathToFileURL(esmEntry).href
    ) as Promise<typeof import("web-tree-sitter")>;
  }
  return tierATreeSitterModulePromise;
}

let tierAParserPromise: Promise<{
  readonly parser: TreeSitterParser;
  readonly provider: DefaultProvider;
}> | null = null;

async function getTierAParser(): Promise<{
  readonly parser: TreeSitterParser;
  readonly provider: DefaultProvider;
}> {
  if (!tierAParserPromise) {
    tierAParserPromise = (async () => {
      const { Language, Parser } = await getTierATreeSitterModule();
      await Parser.init();
      const { wasmPath, attemptedPaths } = resolveWasmPath(
        typescriptConfig.wasm_file,
      );
      if (!existsSync(wasmPath))
        throw new Error(
          `TypeScript grammar not found: ${attemptedPaths.join(", ")}`,
        );
      const language = await Language.load(wasmPath);
      const parser = new Parser() as TreeSitterParser;
      parser.setLanguage(language);
      const provider = new DefaultProvider(typescriptConfig);
      provider.initQueries?.(language);
      return { parser, provider };
    })();
  }
  return tierAParserPromise;
}

export class System1SnapshotSyntax {
  private readonly parser: CoreSystem1SnapshotSyntax;
  private readonly tierAIndex = new Map<
    string,
    ReadonlyMap<string, TierAIndexedDeclaration>
  >();

  private constructor(
    private readonly root: string,
    private readonly trackedFiles: ReadonlySet<string>,
    private readonly treeSitterParser: TreeSitterParser,
    private readonly tierAProvider: DefaultProvider,
  ) {
    const projectOptionsCache = new Map<string, System1ProjectOptions>();
    const readText = (file: string): string | undefined => {
      if (!trackedFiles.has(file)) return undefined;
      try {
        return readFileSync(path.join(root, file), "utf8");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === SOURCE_FILE_NOT_FOUND_CODE
        )
          return undefined;
        throw error;
      }
    };
    const environment: System1SyntaxEnvironment = {
      trackedFiles,
      readText,
      tierADeclaration: (file, targetId) =>
        this.indexedDeclarations(file).get(targetId),
      projectOptions: (projectId) => {
        const cached = projectOptionsCache.get(projectId);
        if (cached) return cached;
        const configPath = path.resolve(root, projectId);
        const parsed = parseSystem1ProjectOptions({
          configPath,
          snapshotRoot: root,
          trackedFiles,
          readText,
        });
        projectOptionsCache.set(projectId, parsed);
        return parsed;
      },
      resolveModule: (specifier, callerFile, options) => {
        const snapshotPath = (fileName: string): string =>
          path.relative(root, fileName).split(path.sep).join("/");
        const host: ts.ModuleResolutionHost = {
          fileExists: (fileName) => trackedFiles.has(snapshotPath(fileName)),
          readFile: (fileName) => readText(snapshotPath(fileName)),
          directoryExists: (directoryName) => {
            const prefix = `${snapshotPath(directoryName).replace(/\/$/, "")}/`;
            return [...trackedFiles].some((file) => file.startsWith(prefix));
          },
          getCurrentDirectory: () => root,
          getDirectories: (directoryName) => {
            const prefix = `${snapshotPath(directoryName).replace(/\/$/, "")}/`;
            const directories = new Set<string>();
            for (const file of trackedFiles) {
              if (!file.startsWith(prefix)) continue;
              const rest = file.slice(prefix.length);
              const slash = rest.indexOf("/");
              if (slash >= 0)
                directories.add(path.join(directoryName, rest.slice(0, slash)));
            }
            return [...directories];
          },
          realpath: (fileName) => fileName,
          useCaseSensitiveFileNames: true,
        };
        const resolved = ts.resolveModuleName(
          specifier,
          path.resolve(root, callerFile),
          options,
          host,
        ).resolvedModule?.resolvedFileName;
        if (!resolved) return undefined;
        const relative = snapshotPath(resolved);
        return trackedFiles.has(relative) ? relative : undefined;
      },
    };
    this.parser = new CoreSystem1SnapshotSyntax(environment);
  }

  static async create(
    root: string,
    trackedFiles: ReadonlySet<string>,
  ): Promise<System1SnapshotSyntax> {
    const { parser, provider } = await getTierAParser();
    return new System1SnapshotSyntax(root, trackedFiles, parser, provider);
  }

  private indexedDeclarations(
    file: string,
  ): ReadonlyMap<string, TierAIndexedDeclaration> {
    const cached = this.tierAIndex.get(file);
    if (cached) return cached;
    if (!this.trackedFiles.has(file)) {
      const missing = new Map<string, TierAIndexedDeclaration>();
      this.tierAIndex.set(file, missing);
      return missing;
    }
    let source: string;
    try {
      source = readFileSync(path.join(this.root, file), "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === SOURCE_FILE_NOT_FOUND_CODE
      ) {
        const missing = new Map<string, TierAIndexedDeclaration>();
        this.tierAIndex.set(file, missing);
        return missing;
      }
      throw error;
    }
    const tree = this.treeSitterParser.parse(source);
    if (!tree) {
      const missing = new Map<string, TierAIndexedDeclaration>();
      this.tierAIndex.set(file, missing);
      return missing;
    }
    try {
      const declarations = extractTierAIndexedDeclarations(
        file,
        tree,
        this.tierAProvider,
      );
      const indexed = new Map(
        declarations.map((declaration) => [declaration.nodeKey, declaration]),
      );
      this.tierAIndex.set(file, indexed);
      return indexed;
    } finally {
      tree.delete();
    }
  }

  build(
    callSite: SemanticCollectionCallSite,
    candidateSet: SemanticTierACandidateSet,
    candidateNodes: ReadonlyMap<string, SemanticCollectionGraphNode>,
    candidateRanks: ReadonlyMap<
      string,
      {
        readonly rank: System1CandidateInput["tierARank"];
        readonly evidence: System1CandidateInput["tierAEvidence"];
      }
    >,
    projectId: string,
  ) {
    return this.parser.build(
      callSite,
      candidateSet,
      candidateNodes,
      candidateRanks,
      projectId,
    );
  }
}
