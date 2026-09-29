/** C-05 LSP oracle (#506): real typescript-language-server `textDocument/definition` at Tier A
 *  call-site positions, one server per tsconfig project group, distinct failure outcomes. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type {
  SemanticCollectionCallSite,
  SemanticOracleAnswer,
  SemanticOracleOutcome,
} from "../../lib/contracts/src/index.js";
import { LspJsonRpcClient } from "../../lib/core/src/lsp/lsp-json-rpc-client.js";
import { oracleOutcome } from "../../lib/core/src/semantic/collection/semantic-target-mapping.js";
import { callSiteId } from "../../lib/core/src/semantic/collection/semantic-sample-builder.js";
import { declarationRef } from "./checker.mjs";
import { typescriptLanguageServerEntry } from "./typescript-language-server.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SERVER_ENTRY = typescriptLanguageServerEntry();
const LANGUAGE_IDS: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
};

export interface OracleOptions {
  readonly requestTimeoutMs: number;
  readonly readinessCapMs: number;
  readonly readinessPollMs: number;
  readonly maxTsServerMemoryMb: number;
}

export interface OracleIdentity {
  readonly server: string;
  readonly version: string;
  readonly configHash: string;
}

export interface OracleGroup {
  readonly projectId: string;
  readonly sites: readonly SemanticCollectionCallSite[];
  /** Call sites the checker resolved cross-file; polled round-robin until one resolves. */
  readonly probes: readonly SemanticCollectionCallSite[];
}

export interface OracleRun {
  readonly outcomes: Map<string, SemanticOracleOutcome>;
  readonly readiness: { projectId: string; ready: boolean; readyMs: number }[];
  readonly requests: number;
  readonly readinessProbeRequests: number;
  readonly processStarts: number;
}

function serverVersions(): { server: string; tsserver: string } {
  const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
  const server = requireFromRoot("typescript-language-server/package.json") as {
    version: string;
  };
  return { server: server.version, tsserver: ts.version };
}

export function oracleIdentity(options: OracleOptions): OracleIdentity {
  const versions = serverVersions();
  const config = {
    initializationOptions: { maxTsServerMemory: options.maxTsServerMemoryMb },
    capabilities: {
      textDocument: {
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      },
    },
    method: "textDocument/definition",
    requestTimeoutMs: options.requestTimeoutMs,
    readiness: {
      capMs: options.readinessCapMs,
      pollMs: options.readinessPollMs,
    },
    versions,
  };
  return {
    server: "typescript-language-server",
    version: `${versions.server}+tsserver@${versions.tsserver}`,
    configHash: createHash("sha256")
      .update(JSON.stringify(config), "utf8")
      .digest("hex"),
  };
}

type Location = {
  uri: string;
  range: { start: { line: number; character: number } };
};
type DefinitionResult = Location | Location[] | null;

class DeclarationLocator {
  private readonly files = new Map<string, ts.SourceFile | null>();
  constructor(private readonly root: string) {}

  private sourceFile(relative: string): ts.SourceFile | null {
    if (!this.files.has(relative)) {
      let parsed: ts.SourceFile | null = null;
      try {
        const text = readFileSync(path.join(this.root, relative), "utf8");
        parsed = ts.createSourceFile(
          path.join(this.root, relative),
          text,
          ts.ScriptTarget.Latest,
          true,
        );
      } catch {
        parsed = null;
      }
      this.files.set(relative, parsed);
    }
    return this.files.get(relative)!;
  }

  answer(result: DefinitionResult): SemanticOracleAnswer {
    const locations =
      result === null ? [] : Array.isArray(result) ? result : [result];
    return {
      kind: "locations",
      locations: locations.map((l) => this.locate(l)),
    };
  }

  private locate(location: Location) {
    const absolute = fileURLToPath(location.uri);
    const relative = path
      .relative(this.root, absolute)
      .split(path.sep)
      .join("/");
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.includes("node_modules/")
    )
      return { external: true, filePath: absolute, declaration: null };
    const sourceFile = this.sourceFile(relative);
    return {
      external: false,
      filePath: relative,
      declaration: sourceFile ? this.declarationAt(sourceFile, location) : null,
    };
  }

  private declarationAt(sourceFile: ts.SourceFile, location: Location) {
    const { line, character } = location.range.start;
    if (line >= sourceFile.getLineStarts().length) return null;
    const position = sourceFile.getPositionOfLineAndCharacter(line, character);
    let found: ts.Node | undefined;
    const visit = (node: ts.Node): void => {
      if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
        found = node;
        ts.forEachChild(node, visit);
      }
    };
    visit(sourceFile);
    const parent = found?.parent;
    if (
      !found ||
      !parent ||
      ts.getNameOfDeclaration(parent as ts.Declaration) !== found
    )
      return null;
    return declarationRef(this.root, parent as ts.Declaration);
  }
}

class OracleSession {
  readonly client = new LspJsonRpcClient();
  requests = 0;
  /** Readiness polls; timing-dependent, so kept apart from the per-site request count. */
  probeRequests = 0;
  constructor(
    private readonly root: string,
    private readonly options: OracleOptions,
  ) {}

  async start(): Promise<void> {
    await this.client.start({
      command: process.execPath,
      args: [SERVER_ENTRY, "--stdio"],
      cwd: this.root,
    });
    const rootUri = pathToFileURL(this.root).toString();
    await this.client.request(
      "initialize",
      {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
        },
        workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
        initializationOptions: {
          maxTsServerMemory: this.options.maxTsServerMemoryMb,
        },
      },
      this.options.requestTimeoutMs,
    );
    this.client.notify("initialized", {});
  }

  open(file: string): string {
    const uri = pathToFileURL(path.join(this.root, file)).toString();
    const text = readFileSync(path.join(this.root, file), "utf8");
    const languageId = LANGUAGE_IDS[path.extname(file)] ?? "typescript";
    this.client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    return uri;
  }

  close(uri: string): void {
    this.client.notify("textDocument/didClose", { textDocument: { uri } });
  }

  async definition(
    uri: string,
    site: SemanticCollectionCallSite,
    probe = false,
  ): Promise<DefinitionResult> {
    if (probe) this.probeRequests++;
    else this.requests++;
    return this.client.request<DefinitionResult>(
      "textDocument/definition",
      {
        textDocument: { uri },
        position: { line: site.line, character: site.column },
      },
      this.options.requestTimeoutMs,
    );
  }

  async stop(): Promise<void> {
    try {
      await this.client.request(
        "shutdown",
        null,
        this.options.requestTimeoutMs,
      );
      this.client.notify("exit", {});
    } catch {
      // best-effort teardown; the client stop below always releases the process
    } finally {
      await this.client.stop();
    }
  }
}

const TIMEOUT_MESSAGE = /timed out/i;

function failureAnswer(error: unknown): SemanticOracleAnswer {
  const message = error instanceof Error ? error.message : String(error);
  return { kind: TIMEOUT_MESSAGE.test(message) ? "timeout" : "error", message };
}

/** Readiness = the semantic server answers a probe with a mapped cross-file target. While
 *  typescript-language-server's syntax server is still standing in for a loading project it only
 *  answers same-file/lib definitions, so "any non-empty answer" is not proof of readiness. */
async function awaitReadiness(
  session: OracleSession,
  probes: readonly SemanticCollectionCallSite[],
  locator: DeclarationLocator,
  nodeKeys: ReadonlySet<string>,
  options: OracleOptions,
): Promise<{ ready: boolean; readyMs: number }> {
  const started = performance.now();
  if (probes.length === 0) return { ready: true, readyMs: 0 };
  const uris = probes.map((probe) => session.open(probe.filePath));
  try {
    for (
      let attempt = 0;
      performance.now() - started < options.readinessCapMs;
      attempt++
    ) {
      const probe = probes[attempt % probes.length];
      const result = await session
        .definition(uris[attempt % probes.length], probe, true)
        .catch(() => null);
      if (
        oracleOutcome(locator.answer(result), probe.filePath, nodeKeys)
          .status === "resolved"
      )
        return { ready: true, readyMs: performance.now() - started };
      await new Promise((resolve) =>
        setTimeout(resolve, options.readinessPollMs),
      );
    }
    return { ready: false, readyMs: performance.now() - started };
  } finally {
    for (const uri of new Set(uris)) session.close(uri);
  }
}

async function resolveGroup(
  session: OracleSession,
  group: OracleGroup,
  locator: DeclarationLocator,
  nodeKeys: ReadonlySet<string>,
  outcomes: Map<string, SemanticOracleOutcome>,
): Promise<void> {
  const byFile = new Map<string, SemanticCollectionCallSite[]>();
  for (const site of group.sites)
    byFile.set(site.filePath, [...(byFile.get(site.filePath) ?? []), site]);
  for (const file of [...byFile.keys()].sort()) {
    const sites = byFile.get(file)!;
    const uri = session.open(file);
    const answers = await Promise.all(
      sites.map((site) =>
        session.definition(uri, site).then(
          (result) => locator.answer(result),
          (error: unknown) => failureAnswer(error),
        ),
      ),
    );
    session.close(uri);
    sites.forEach((site, i) =>
      outcomes.set(callSiteId(site), oracleOutcome(answers[i], file, nodeKeys)),
    );
  }
}

/** Runs the oracle group by group; each group gets a fresh server (bounded memory). */
export async function runOracle(
  root: string,
  groups: readonly OracleGroup[],
  nodeKeys: ReadonlySet<string>,
  options: OracleOptions,
  beforeGroup?: () => void,
): Promise<OracleRun> {
  const outcomes = new Map<string, SemanticOracleOutcome>();
  const readiness: OracleRun["readiness"] = [];
  const locator = new DeclarationLocator(root);
  let requests = 0;
  let readinessProbeRequests = 0;
  let processStarts = 0;
  for (const group of [...groups].sort((a, b) =>
    a.projectId < b.projectId ? -1 : 1,
  )) {
    beforeGroup?.();
    const session = new OracleSession(root, options);
    processStarts++;
    try {
      await session.start();
      const ready = await awaitReadiness(
        session,
        group.probes,
        locator,
        nodeKeys,
        options,
      );
      readiness.push({ projectId: group.projectId, ...ready });
      if (!ready.ready) {
        for (const site of group.sites)
          outcomes.set(callSiteId(site), {
            status: "not-ready",
            targetIds: [],
            unmappedLocations: 0,
          });
        continue;
      }
      await resolveGroup(session, group, locator, nodeKeys, outcomes);
    } catch (error) {
      for (const site of group.sites)
        if (!outcomes.has(callSiteId(site)))
          outcomes.set(
            callSiteId(site),
            oracleOutcome(failureAnswer(error), site.filePath, nodeKeys),
          );
    } finally {
      requests += session.requests;
      readinessProbeRequests += session.probeRequests;
      await session.stop();
    }
  }
  return {
    outcomes,
    readiness,
    requests,
    readinessProbeRequests,
    processStarts,
  };
}
