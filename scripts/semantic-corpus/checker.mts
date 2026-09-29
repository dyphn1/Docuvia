/** C-04 independent evidence (#506): the TypeScript type checker selects the population and
 *  supplies gold targets; a parser-only import trace audits them. One program at a time. */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  SemanticCollectionCallSite,
  SemanticCollectionExclusion,
  SemanticDeclarationRef,
  SemanticSourceAuditResult,
} from "../../lib/contracts/src/index.js";
import { mapDeclarationToNodeKey } from "../../lib/core/src/semantic/collection/semantic-target-mapping.js";
import {
  auditImportedTarget,
  type ImportBinding,
  type ModuleSyntax,
} from "../../lib/core/src/semantic/collection/semantic-import-audit.js";
import { fragmentKey } from "../../lib/core/src/semantic/collection/semantic-dedup-splits.js";

export const TYPESCRIPT_FILE = /\.(?:ts|tsx|mts|cts)$/;
const DECLARATION_FILE = /\.d\.[mc]?ts$/;

export interface CheckedCallSite {
  readonly callSite: SemanticCollectionCallSite;
  readonly projectId: string | null;
  readonly exclusion: SemanticCollectionExclusion | null;
  readonly declarations: { nodeKey: string; ref: SemanticDeclarationRef }[];
  readonly audit: SemanticSourceAuditResult;
  readonly duplicateGroup: string;
}

interface ProjectConfig {
  readonly configPath: string;
  readonly parsed: ts.ParsedCommandLine;
  readonly fileSet: ReadonlySet<string>;
}

const rel = (root: string, file: string): string =>
  path.relative(root, file).split(path.sep).join("/");

/** Snapshot-local tsconfig discovery, mirroring tsserver: nearest config, then its references. */
class ProjectResolver {
  private readonly cache = new Map<string, ProjectConfig | null>();
  constructor(private readonly root: string) {}

  private load(configPath: string): ProjectConfig | null {
    if (this.cache.has(configPath)) return this.cache.get(configPath)!;
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = read.error
      ? null
      : ts.parseJsonConfigFileContent(
          read.config,
          ts.sys,
          path.dirname(configPath),
        );
    const config = parsed
      ? {
          configPath,
          parsed,
          fileSet: new Set(parsed.fileNames.map((f) => path.resolve(f))),
        }
      : null;
    this.cache.set(configPath, config);
    return config;
  }

  private nearest(file: string): string | undefined {
    const found = ts.findConfigFile(path.dirname(file), ts.sys.fileExists);
    return found && !path.relative(this.root, found).startsWith("..")
      ? found
      : undefined;
  }

  owner(file: string): ProjectConfig | null {
    const start = this.nearest(file);
    const queue = start ? [start] : [];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const configPath = path.resolve(queue.shift()!);
      if (seen.has(configPath)) continue;
      seen.add(configPath);
      const config = this.load(configPath);
      if (!config) continue;
      if (config.fileSet.has(file)) return config;
      for (const ref of config.parsed.projectReferences ?? [])
        queue.push(ts.resolveProjectReferencePath(ref));
    }
    return null;
  }
}

function tokenAt(
  sourceFile: ts.SourceFile,
  position: number,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return found;
}

function isConcrete(declaration: ts.Declaration): boolean {
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration)
  )
    return declaration.body !== undefined;
  if (
    ts.isClassDeclaration(declaration) ||
    ts.isConstructorDeclaration(declaration)
  )
    return true;
  if (ts.isVariableDeclaration(declaration)) {
    const init = declaration.initializer;
    return (
      init !== undefined &&
      (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
    );
  }
  return false;
}

function containerOf(declaration: ts.Node): string | undefined {
  for (let node = declaration.parent; node; node = node.parent)
    if (ts.isClassLike(node) && node.name) return node.name.text;
  return undefined;
}

export function declarationRef(
  root: string,
  declaration: ts.Declaration,
): SemanticDeclarationRef | null {
  const name = ts.getNameOfDeclaration(declaration);
  if (!name || !(ts.isIdentifier(name) || ts.isPrivateIdentifier(name)))
    return null;
  const sourceFile = declaration.getSourceFile();
  const line = (pos: number): number =>
    sourceFile.getLineAndCharacterOfPosition(pos).line;
  return {
    filePath: rel(root, sourceFile.fileName),
    name: name.text,
    ...(containerOf(declaration)
      ? { containerName: containerOf(declaration) }
      : {}),
    startLine: line(declaration.getStart(sourceFile)),
    nameLine: line(name.getStart(sourceFile)),
    concrete: isConcrete(declaration),
  };
}

function isExternal(root: string, fileName: string): boolean {
  const relative = rel(root, fileName);
  return relative.startsWith("..") || relative.includes("node_modules/");
}

type Resolution =
  | { exclusion: SemanticCollectionExclusion }
  | { declarations: { nodeKey: string; ref: SemanticDeclarationRef }[] };

function resolveDeclarations(
  root: string,
  callerFile: string,
  declarations: readonly ts.Declaration[],
  nodeKeys: ReadonlySet<string>,
): Resolution {
  if (declarations.length === 0) return { exclusion: "checker-unresolved" };
  if (declarations.some((d) => isExternal(root, d.getSourceFile().fileName)))
    return { exclusion: "external-target" };
  const refs = declarations.map((d) => declarationRef(root, d));
  if (refs.every((r) => r?.filePath === callerFile))
    return { exclusion: "same-file-target" };
  const mapped: { nodeKey: string; ref: SemanticDeclarationRef }[] = [];
  for (const ref of refs) {
    const nodeKey =
      ref && !DECLARATION_FILE.test(ref.filePath)
        ? mapDeclarationToNodeKey(ref, nodeKeys)
        : undefined;
    if (!ref || nodeKey === undefined)
      return { exclusion: "unmappable-target" };
    mapped.push({ nodeKey, ref });
  }
  return { declarations: mapped };
}

function checkerDeclarations(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  site: SemanticCollectionCallSite,
): readonly ts.Declaration[] | "no-identifier-at-position" {
  if (site.line >= sourceFile.getLineStarts().length)
    return "no-identifier-at-position";
  const token = tokenAt(
    sourceFile,
    sourceFile.getPositionOfLineAndCharacter(site.line, site.column),
  );
  if (!token || !(ts.isIdentifier(token) || ts.isPrivateIdentifier(token)))
    return "no-identifier-at-position";
  let symbol = checker.getSymbolAtLocation(token);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations ?? [];
}

/** Parser-only syntax for the C-04 audit, independent of the binder/checker. */
export class SyntaxTables {
  private readonly modules = new Map<string, ModuleSyntax | undefined>();
  private readonly lines = new Map<string, string[]>();
  constructor(
    private readonly root: string,
    private readonly files: ReadonlySet<string>,
  ) {}

  private parse(file: string): ts.SourceFile | undefined {
    if (!this.files.has(file)) return undefined;
    const text = readFileSync(path.join(this.root, file), "utf8");
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  }

  linesOf(file: string): string[] {
    if (!this.lines.has(file))
      this.lines.set(
        file,
        readFileSync(path.join(this.root, file), "utf8").split(/\r?\n/),
      );
    return this.lines.get(file)!;
  }

  importsOf(file: string): ImportBinding[] {
    const sourceFile = this.parse(file);
    const bindings: ImportBinding[] = [];
    for (const statement of sourceFile?.statements ?? []) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name)
        bindings.push({
          local: clause.name.text,
          imported: "default",
          specifier,
        });
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named))
        bindings.push({ local: named.name.text, imported: "*", specifier });
      if (named && ts.isNamedImports(named))
        for (const element of named.elements)
          bindings.push({
            local: element.name.text,
            imported: (element.propertyName ?? element.name).text,
            specifier,
          });
    }
    return bindings;
  }

  moduleOf(file: string): ModuleSyntax | undefined {
    if (!this.modules.has(file)) this.modules.set(file, this.readModule(file));
    return this.modules.get(file);
  }

  private readModule(file: string): ModuleSyntax | undefined {
    const sourceFile = this.parse(file);
    if (!sourceFile) return undefined;
    const declared: string[] = [];
    const classes: string[] = [];
    const reexports: {
      exported: string;
      imported: string;
      specifier: string;
    }[] = [];
    for (const statement of sourceFile.statements) {
      collectDeclared(statement, declared, classes);
      collectReexports(statement, reexports, declared);
    }
    return { declared, classes, reexports };
  }
}

function collectDeclared(
  statement: ts.Statement,
  declared: string[],
  classes: string[],
): void {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  ) {
    declared.push(statement.name.text);
    if (ts.isClassDeclaration(statement)) classes.push(statement.name.text);
  }
  if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name))
        declared.push(declaration.name.text);
}

function collectReexports(
  statement: ts.Statement,
  reexports: { exported: string; imported: string; specifier: string }[],
  declared: string[],
): void {
  if (!ts.isExportDeclaration(statement)) return;
  const specifier =
    statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  const clause = statement.exportClause;
  if (specifier && !clause)
    reexports.push({ exported: "*", imported: "*", specifier });
  if (!clause || !ts.isNamedExports(clause)) return;
  for (const element of clause.elements) {
    const exported = element.name.text;
    const imported = (element.propertyName ?? element.name).text;
    if (specifier) reexports.push({ exported, imported, specifier });
    else if (declared.includes(imported)) declared.push(exported);
  }
}

export interface CheckerRun {
  readonly results: CheckedCallSite[];
  readonly programs: number;
  readonly typescriptVersion: string;
}

function excluded(
  site: SemanticCollectionCallSite,
  projectId: string | null,
  exclusion: SemanticCollectionExclusion,
  duplicateGroup: string,
): CheckedCallSite {
  return {
    callSite: site,
    projectId,
    exclusion,
    declarations: [],
    audit: { kind: "not-applicable", reason: exclusion },
    duplicateGroup,
  };
}

/** Evaluates every TypeScript call site, one tsconfig program at a time. */
export function collectCheckerEvidence(
  root: string,
  callSites: readonly SemanticCollectionCallSite[],
  nodeKeys: ReadonlySet<string>,
  snapshotFiles: ReadonlySet<string>,
  onProgram?: () => void,
): CheckerRun {
  const resolver = new ProjectResolver(root);
  const syntax = new SyntaxTables(root, snapshotFiles);
  const groups = new Map<string, SemanticCollectionCallSite[]>();
  const results: CheckedCallSite[] = [];
  const fragment = (site: SemanticCollectionCallSite): string =>
    fragmentKey(syntax.linesOf(site.filePath), site.line, site.calleeName);
  for (const site of callSites) {
    if (
      !TYPESCRIPT_FILE.test(site.filePath) ||
      DECLARATION_FILE.test(site.filePath)
    ) {
      results.push(excluded(site, null, "non-typescript-file", fragment(site)));
      continue;
    }
    const owner = resolver.owner(path.resolve(root, site.filePath));
    if (!owner) {
      results.push(
        excluded(site, null, "no-configured-project", fragment(site)),
      );
      continue;
    }
    groups.set(owner.configPath, [
      ...(groups.get(owner.configPath) ?? []),
      site,
    ]);
  }
  for (const configPath of [...groups.keys()].sort()) {
    onProgram?.();
    const config = resolver.owner(
      path.resolve(root, groups.get(configPath)![0].filePath),
    )!;
    const program = ts.createProgram({
      rootNames: config.parsed.fileNames,
      options: config.parsed.options,
      projectReferences: config.parsed.projectReferences,
    });
    const checker = program.getTypeChecker();
    const projectId = rel(root, configPath);
    for (const site of groups.get(configPath)!)
      results.push(
        checkSite(
          root,
          program,
          checker,
          site,
          projectId,
          nodeKeys,
          syntax,
          fragment(site),
        ),
      );
  }
  return { results, programs: groups.size, typescriptVersion: ts.version };
}

function checkSite(
  root: string,
  program: ts.Program,
  checker: ts.TypeChecker,
  site: SemanticCollectionCallSite,
  projectId: string,
  nodeKeys: ReadonlySet<string>,
  syntax: SyntaxTables,
  duplicateGroup: string,
): CheckedCallSite {
  const sourceFile = program.getSourceFile(path.resolve(root, site.filePath));
  if (!sourceFile)
    return excluded(site, projectId, "no-configured-project", duplicateGroup);
  const declarations = checkerDeclarations(checker, sourceFile, site);
  if (declarations === "no-identifier-at-position")
    return excluded(site, projectId, declarations, duplicateGroup);
  const resolution = resolveDeclarations(
    root,
    site.filePath,
    declarations,
    nodeKeys,
  );
  if ("exclusion" in resolution)
    return excluded(site, projectId, resolution.exclusion, duplicateGroup);
  const goldFiles = resolution.declarations
    .map((d) => d.ref.filePath)
    .filter((f) => f !== site.filePath);
  const audit = auditImportedTarget({
    callerFile: site.filePath,
    calleeName: site.calleeName,
    calleeKind: site.calleeKind,
    receiverText: receiverOf(syntax, site),
    imports: syntax.importsOf(site.filePath),
    goldFiles,
    fileExists: (file) => syntax.moduleOf(file) !== undefined,
    moduleOf: (file) => syntax.moduleOf(file),
  });
  return {
    callSite: site,
    projectId,
    exclusion: null,
    declarations: resolution.declarations,
    audit,
    duplicateGroup,
  };
}

/** The identifier immediately left of `.callee` on the call line, if any (syntactic only). */
function receiverOf(
  syntax: SyntaxTables,
  site: SemanticCollectionCallSite,
): string | null {
  const text = syntax.linesOf(site.filePath)[site.line] ?? "";
  const match = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(text.slice(0, site.column));
  return match ? match[1] : null;
}
