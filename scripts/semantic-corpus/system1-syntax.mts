/** Snapshot I/O and TypeScript module resolution for the pure System-1 parser. */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
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

export class System1SnapshotSyntax {
  private readonly parser: CoreSystem1SnapshotSyntax;

  constructor(
    private readonly root: string,
    private readonly trackedFiles: ReadonlySet<string>,
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
