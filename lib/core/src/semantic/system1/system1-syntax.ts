/** Pure parser-only syntax projection for the P1 System-1 state encoding. */
import ts from "typescript";
import { LanguageNodeTypes } from "@workspace/ast-core";
import type { TierAIndexedDeclaration } from "../../ast/tier-a-declaration-index.js";
import { AstNodeTypes } from "../../ast/ast-constants.js";
import {
  SYSTEM1_BARREL_STATUSES,
  SYSTEM1_BOUNDED_IMPORT_MAX_BYTES,
  SYSTEM1_BYTE_LIMITS,
  SYSTEM1_CALL_SOURCE_LINES,
  SYSTEM1_CALL_KINDS,
  SYSTEM1_CONSTRUCTOR_SYMBOL_NAME,
  SYSTEM1_DECLARATION_KINDS,
  SYSTEM1_EVIDENCE_STATUSES,
  SYSTEM1_FRAMEWORK_DECORATORS,
  SYSTEM1_FRAMEWORK_PACKAGES,
  SYSTEM1_FRAMEWORK_REGISTRIES,
  SYSTEM1_FRAMEWORK_REGISTRY_METHODS,
  SYSTEM1_GENERATED_FILE_MARKERS,
  SYSTEM1_GENERATED_PATH_COMPONENTS,
  SYSTEM1_IMPORT_KINDS,
  SYSTEM1_BUILTIN_MEMBER_METHODS,
  SYSTEM1_BUILTIN_TYPE_NAMES,
} from "./system1-constants.js";
import type {
  System1AmbiguityEvidence,
  System1CallKind,
  System1CandidateInput,
  System1ImportBinding,
} from "./system1-types.js";
import type {
  SemanticCollectionCallSite,
  SemanticCollectionGraphNode,
  SemanticTierACandidateSet,
} from "../../../../contracts/src/index.js";

const GENERATED_MARKER = /@generated\b/i;
const DECLARATION_NAME_NODE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.EnumDeclaration,
]);
const TIER_A_KIND_BY_NODE_TYPE = new Map<
  string,
  System1CandidateInput["declarationKind"]
>([
  [LanguageNodeTypes.METHOD_DEFINITION, SYSTEM1_DECLARATION_KINDS.METHOD],
  [LanguageNodeTypes.FUNCTION_DECLARATION, SYSTEM1_DECLARATION_KINDS.FUNCTION],
  [LanguageNodeTypes.ARROW_FUNCTION, SYSTEM1_DECLARATION_KINDS.FUNCTION],
  [LanguageNodeTypes.FUNCTION_EXPRESSION, SYSTEM1_DECLARATION_KINDS.FUNCTION],
  [
    LanguageNodeTypes.GENERATOR_FUNCTION_DECLARATION,
    SYSTEM1_DECLARATION_KINDS.FUNCTION,
  ],
  [LanguageNodeTypes.GENERATOR_FUNCTION, SYSTEM1_DECLARATION_KINDS.FUNCTION],
  [LanguageNodeTypes.CLASS_DECLARATION, SYSTEM1_DECLARATION_KINDS.CLASS],
  [
    LanguageNodeTypes.ABSTRACT_CLASS_DECLARATION,
    SYSTEM1_DECLARATION_KINDS.CLASS,
  ],
  [
    LanguageNodeTypes.INTERFACE_DECLARATION,
    SYSTEM1_DECLARATION_KINDS.INTERFACE,
  ],
  [
    LanguageNodeTypes.TYPE_ALIAS_DECLARATION,
    SYSTEM1_DECLARATION_KINDS.TYPE_ALIAS,
  ],
  [LanguageNodeTypes.ENUM_DECLARATION, SYSTEM1_DECLARATION_KINDS.ENUM],
  [AstNodeTypes.VARIABLE_DECLARATOR, SYSTEM1_DECLARATION_KINDS.VARIABLE],
]);
const SYSTEM1_KIND_BY_TYPESCRIPT_NODE_KIND = new Map<
  ts.SyntaxKind,
  System1CandidateInput["declarationKind"]
>([
  [ts.SyntaxKind.FunctionDeclaration, SYSTEM1_DECLARATION_KINDS.FUNCTION],
  [ts.SyntaxKind.FunctionExpression, SYSTEM1_DECLARATION_KINDS.FUNCTION],
  [ts.SyntaxKind.ArrowFunction, SYSTEM1_DECLARATION_KINDS.FUNCTION],
  [ts.SyntaxKind.MethodDeclaration, SYSTEM1_DECLARATION_KINDS.METHOD],
  [ts.SyntaxKind.MethodSignature, SYSTEM1_DECLARATION_KINDS.METHOD],
  [ts.SyntaxKind.GetAccessor, SYSTEM1_DECLARATION_KINDS.METHOD],
  [ts.SyntaxKind.SetAccessor, SYSTEM1_DECLARATION_KINDS.METHOD],
  [ts.SyntaxKind.Constructor, SYSTEM1_DECLARATION_KINDS.CONSTRUCTOR],
  [ts.SyntaxKind.ClassDeclaration, SYSTEM1_DECLARATION_KINDS.CLASS],
  [ts.SyntaxKind.ClassExpression, SYSTEM1_DECLARATION_KINDS.CLASS],
  [ts.SyntaxKind.InterfaceDeclaration, SYSTEM1_DECLARATION_KINDS.INTERFACE],
  [ts.SyntaxKind.TypeAliasDeclaration, SYSTEM1_DECLARATION_KINDS.TYPE_ALIAS],
  [ts.SyntaxKind.EnumDeclaration, SYSTEM1_DECLARATION_KINDS.ENUM],
  [ts.SyntaxKind.VariableDeclaration, SYSTEM1_DECLARATION_KINDS.VARIABLE],
  [ts.SyntaxKind.PropertyDeclaration, SYSTEM1_DECLARATION_KINDS.PROPERTY],
  [ts.SyntaxKind.PropertySignature, SYSTEM1_DECLARATION_KINDS.PROPERTY],
  [ts.SyntaxKind.PropertyAssignment, SYSTEM1_DECLARATION_KINDS.PROPERTY],
]);
const TIER_A_TYPE_MATCHERS = new Map<string, (node: ts.Node) => boolean>([
  [LanguageNodeTypes.FUNCTION_DECLARATION, ts.isFunctionDeclaration],
  [LanguageNodeTypes.FUNCTION_EXPRESSION, ts.isFunctionExpression],
  [LanguageNodeTypes.ARROW_FUNCTION, ts.isArrowFunction],
  [
    LanguageNodeTypes.GENERATOR_FUNCTION_DECLARATION,
    (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node),
  ],
  [
    LanguageNodeTypes.GENERATOR_FUNCTION,
    (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node),
  ],
  [
    LanguageNodeTypes.METHOD_DEFINITION,
    (node) =>
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node),
  ],
  [LanguageNodeTypes.CLASS_DECLARATION, (node) => ts.isClassDeclaration(node)],
  [
    LanguageNodeTypes.ABSTRACT_CLASS_DECLARATION,
    (node) => ts.isClassDeclaration(node),
  ],
  [LanguageNodeTypes.INTERFACE_DECLARATION, ts.isInterfaceDeclaration],
  [LanguageNodeTypes.TYPE_ALIAS_DECLARATION, ts.isTypeAliasDeclaration],
  [LanguageNodeTypes.ENUM_DECLARATION, ts.isEnumDeclaration],
  [AstNodeTypes.VARIABLE_DECLARATOR, ts.isVariableDeclaration],
]);
export interface System1SyntaxEnvironment {
  readonly trackedFiles: ReadonlySet<string>;
  readonly readText: (file: string) => string | undefined;
  readonly tierADeclaration: (
    file: string,
    targetId: string,
  ) => TierAIndexedDeclaration | undefined;
  readonly projectOptions: (projectId: string) => {
    readonly options: ts.CompilerOptions;
    readonly parsed: boolean;
  };
  readonly resolveModule: (
    specifier: string,
    callerFile: string,
    options: ts.CompilerOptions,
  ) => string | undefined;
}

export interface TierACandidateSyntaxInput {
  readonly id: string;
  readonly targetId: string;
  readonly rank: System1CandidateInput["tierARank"];
  readonly evidence: System1CandidateInput["tierAEvidence"];
  readonly node: SemanticCollectionGraphNode;
}

export interface System1SyntaxResult {
  readonly callerSymbol: string;
  readonly call: {
    readonly calleeName: string;
    readonly expression: string;
    readonly sourceWindow: string;
    readonly sourceWindowTruncated: boolean;
    readonly kind: System1CallKind;
    readonly receiverHint: string | null;
    readonly genericHints: readonly string[];
  };
  readonly importBinding: System1ImportBinding | null;
  readonly candidates: readonly System1CandidateInput[];
  readonly ambiguityEvidence: System1AmbiguityEvidence;
}

export type System1SyntaxFailure =
  (typeof SYSTEM1_SYNTAX_FAILURES)[keyof typeof SYSTEM1_SYNTAX_FAILURES];

const SYSTEM1_SYNTAX_FAILURES = {
  CALLER_FILE_NOT_FOUND: "caller-file-not-found",
  CALL_EXPRESSION_NOT_FOUND: "call-expression-not-found",
} as const;

export class System1SnapshotSyntax {
  private readonly sourceFiles = new Map<string, ts.SourceFile | null>();
  private readonly textFiles = new Map<string, string | null>();

  constructor(private readonly environment: System1SyntaxEnvironment) {}

  private text(file: string): string | undefined {
    if (!this.textFiles.has(file)) {
      const value = this.environment.trackedFiles.has(file)
        ? (this.environment.readText(file) ?? null)
        : null;
      this.textFiles.set(file, value);
    }
    return this.textFiles.get(file) ?? undefined;
  }

  private source(file: string): ts.SourceFile | undefined {
    if (!this.sourceFiles.has(file)) {
      const text = this.text(file);
      this.sourceFiles.set(
        file,
        text === undefined
          ? null
          : ts.createSourceFile(
              file,
              text,
              ts.ScriptTarget.Latest,
              true,
              scriptKind(file),
            ),
      );
    }
    return this.sourceFiles.get(file) ?? undefined;
  }

  build(
    callSite: SemanticCollectionCallSite,
    candidateSet: SemanticTierACandidateSet,
    candidateNodes: ReadonlyMap<string, SemanticCollectionGraphNode>,
    candidateRanks: ReadonlyMap<
      string,
      {
        readonly rank: TierACandidateSyntaxInput["rank"];
        readonly evidence: TierACandidateSyntaxInput["evidence"];
      }
    >,
    projectId: string,
  ):
    | { readonly kind: "ready"; readonly syntax: System1SyntaxResult }
    | { readonly kind: "unavailable"; readonly reason: System1SyntaxFailure } {
    const sourceFile = this.source(callSite.filePath);
    if (!sourceFile)
      return {
        kind: "unavailable",
        reason: SYSTEM1_SYNTAX_FAILURES.CALLER_FILE_NOT_FOUND,
      };
    const position = sourcePosition(sourceFile, callSite.line, callSite.column);
    if (position === null)
      return {
        kind: "unavailable",
        reason: SYSTEM1_SYNTAX_FAILURES.CALL_EXPRESSION_NOT_FOUND,
      };
    const callExpression = findCallExpression(sourceFile, position);
    if (!callExpression)
      return {
        kind: "unavailable",
        reason: SYSTEM1_SYNTAX_FAILURES.CALL_EXPRESSION_NOT_FOUND,
      };

    const project = this.environment.projectOptions(projectId);
    const importSyntax = findImportBinding(sourceFile, callExpression);
    const importBinding = importSyntax
      ? this.describeImport(callSite.filePath, importSyntax, project)
      : null;
    const candidateFacts = buildCandidateFacts(
      candidateSet,
      candidateNodes,
      candidateRanks,
      (node, targetId) => this.describeCandidate(node, targetId),
    );
    const callFacts = buildCallFacts(
      callSite,
      callExpression,
      sourceFile,
      importBinding,
      candidateFacts,
    );
    return {
      kind: "ready",
      syntax: {
        callerSymbol: containingSymbol(callExpression, sourceFile),
        call: callFacts.call,
        importBinding,
        candidates: candidateFacts,
        ambiguityEvidence: callFacts.ambiguityEvidence,
      },
    };
  }

  private describeCandidate(
    graphNode: SemanticCollectionGraphNode | undefined,
    targetId: string,
  ): Omit<
    System1CandidateInput,
    "id" | "targetId" | "tierARank" | "tierAEvidence"
  > {
    if (!graphNode) return missingCandidateSyntax();
    const indexed = this.environment.tierADeclaration(
      graphNode.filePath,
      targetId,
    );
    if (!indexed || indexed.nodeKey !== targetId)
      return missingCandidateSyntax();
    const sourceFile = this.source(graphNode.filePath);
    if (!sourceFile) return missingCandidateSyntax();
    return describeTierADeclaration(graphNode.filePath, indexed, sourceFile);
  }

  private describeImport(
    callerFile: string,
    binding: ImportSyntax,
    project: { readonly options: ts.CompilerOptions; readonly parsed: boolean },
  ): System1ImportBinding {
    const pathAlias = project.parsed
      ? matchesConfiguredPathAlias(binding.specifier, project.options.paths)
      : null;
    const barrelStatus = this.barrelStatus(
      callerFile,
      binding.specifier,
      project.options,
    );
    return {
      kind: binding.kind,
      local: binding.local,
      imported: binding.imported,
      sourceSpecifier: binding.specifier,
      barrelStatus,
      pathAlias,
    };
  }

  private barrelStatus(
    callerFile: string,
    specifier: string,
    options: ts.CompilerOptions,
  ): System1ImportBinding["barrelStatus"] {
    const first = this.environment.resolveModule(
      specifier,
      callerFile,
      options,
    );
    if (!first) return SYSTEM1_BARREL_STATUSES.UNRESOLVED;
    const sourceFile = this.source(first);
    if (!sourceFile) return SYSTEM1_BARREL_STATUSES.UNRESOLVED;
    return moduleReexportsBindings(sourceFile)
      ? SYSTEM1_BARREL_STATUSES.YES
      : SYSTEM1_BARREL_STATUSES.NO;
  }
}

interface ImportSyntax {
  readonly kind: System1ImportBinding["kind"];
  readonly local: string;
  readonly imported: string;
  readonly specifier: string;
}

interface CallFacts {
  readonly call: System1SyntaxResult["call"];
  readonly ambiguityEvidence: System1AmbiguityEvidence;
}

function buildCandidateFacts(
  candidateSet: SemanticTierACandidateSet,
  candidateNodes: ReadonlyMap<string, SemanticCollectionGraphNode>,
  candidateRanks: ReadonlyMap<
    string,
    {
      readonly rank: TierACandidateSyntaxInput["rank"];
      readonly evidence: TierACandidateSyntaxInput["evidence"];
    }
  >,
  describeCandidate: (
    node: SemanticCollectionGraphNode | undefined,
    targetId: string,
  ) => Omit<
    System1CandidateInput,
    "id" | "targetId" | "tierARank" | "tierAEvidence"
  >,
): System1CandidateInput[] {
  return candidateSet.candidates.map((candidate) => {
    const rank = candidateRanks.get(candidate.targetId);
    if (!rank)
      throw new Error(
        `Tier A rank is missing for candidate ${candidate.targetId}`,
      );
    return {
      id: candidate.id,
      targetId: candidate.targetId,
      tierARank: rank.rank,
      tierAEvidence: rank.evidence,
      ...describeCandidate(
        candidateNodes.get(candidate.targetId),
        candidate.targetId,
      ),
    };
  });
}

function buildCallFacts(
  callSite: SemanticCollectionCallSite,
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
  importBinding: System1ImportBinding | null,
  candidates: readonly System1CandidateInput[],
): CallFacts {
  const receiver = callReceiverFacts(callExpression, sourceFile, importBinding);
  const arguments_ = callArgumentHints(callExpression, sourceFile);
  const sourceWindow = boundedCallWindow(sourceFile, callExpression);
  const call = buildCallDescription(
    callSite,
    callExpression,
    sourceFile,
    receiver,
    arguments_.genericHints,
    sourceWindow,
  );
  return {
    call,
    ambiguityEvidence: buildCallAmbiguityEvidence(
      callSite,
      callExpression,
      sourceFile,
      importBinding,
      candidates,
      receiver,
      arguments_,
    ),
  };
}

interface CallReceiverFacts {
  readonly expression: ts.Expression | null;
  readonly kind: System1CallKind;
  readonly thisReceiver: ReturnType<typeof resolveThisFieldReceiver>;
  readonly name: string | null;
  readonly syntax: ReturnType<typeof receiverTypeHint>;
}

interface CallArgumentHints {
  readonly genericHints: readonly string[];
  readonly stringLiteralArguments: readonly string[];
}

function callReceiverFacts(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  importBinding: System1ImportBinding | null,
): CallReceiverFacts {
  const expression = receiverExpression(call.expression);
  const thisReceiver = resolveThisFieldReceiver(expression, call, sourceFile);
  return {
    expression,
    kind: classifyCallKind(call.expression, expression, importBinding),
    thisReceiver,
    name: simpleReceiverName(expression) ?? thisReceiver?.name ?? null,
    syntax: receiverTypeHint(expression, call, sourceFile, thisReceiver),
  };
}

function callArgumentHints(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): CallArgumentHints {
  return {
    genericHints:
      call.typeArguments?.map((argument) => argument.getText(sourceFile)) ?? [],
    stringLiteralArguments: call.arguments
      .filter(isStringArgument)
      .map((argument) => argument.text),
  };
}

function isStringArgument(
  argument: ts.Expression,
): argument is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return (
    ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
  );
}

function buildCallDescription(
  callSite: SemanticCollectionCallSite,
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
  receiver: CallReceiverFacts,
  genericHints: readonly string[],
  sourceWindow: ReturnType<typeof boundedCallWindow>,
): System1SyntaxResult["call"] {
  return {
    calleeName: callSite.calleeName,
    expression: callExpression.getText(sourceFile),
    sourceWindow: sourceWindow.text,
    sourceWindowTruncated: sourceWindow.truncated,
    kind: receiver.kind,
    receiverHint: receiver.expression
      ? `${receiver.expression.getText(sourceFile)}${receiver.syntax?.typeHint ? `: ${receiver.syntax.typeHint}` : ""}`
      : null,
    genericHints,
  };
}

function buildCallAmbiguityEvidence(
  callSite: SemanticCollectionCallSite,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  importBinding: System1ImportBinding | null,
  candidates: readonly System1CandidateInput[],
  receiver: CallReceiverFacts,
  arguments_: CallArgumentHints,
): System1AmbiguityEvidence {
  const localNames = localBindings(call, sourceFile);
  const importedNames = importedLocalNames(sourceFile);
  return {
    call: {
      calleeName: callSite.calleeName,
      kind: receiver.kind,
      receiverName: receiver.name,
      receiverLocallyBound: receiverIsLocal(receiver, localNames),
      receiverImported: receiverIsImported(receiver.name, importedNames),
      receiverTypeKnown: receiver.syntax?.known ?? null,
      fluentChain: isFluentChain(call.expression),
      genericTypeArguments: arguments_.genericHints,
      stringLiteralArguments: arguments_.stringLiteralArguments,
      namespaceCall: isNamespaceBinding(importBinding),
      boundedComputedImport: boundedComputedImport(sourceFile),
      frameworkConvention: isCallFrameworkConvention(call, sourceFile),
    },
    importBinding,
    candidates,
  };
}

function receiverIsLocal(
  receiver: CallReceiverFacts,
  localNames: ReadonlySet<string>,
): boolean {
  if (!receiver.name) return false;
  return (
    localNames.has(receiver.name) ||
    receiver.thisReceiver?.typeHint !== undefined
  );
}

function receiverIsImported(
  receiverName: string | null,
  importedNames: ReadonlySet<string>,
): boolean {
  return receiverName !== null && importedNames.has(receiverName);
}

function isNamespaceBinding(binding: System1ImportBinding | null): boolean {
  return binding?.kind === SYSTEM1_IMPORT_KINDS.NAMESPACE;
}

function isCallFrameworkConvention(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    isFrameworkRegistryLookup(call, sourceFile) ||
    isCallOnInjectedMember(call, sourceFile)
  );
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs"))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function sourcePosition(
  sourceFile: ts.SourceFile,
  line: number,
  column: number,
): number | null {
  if (line >= sourceFile.getLineStarts().length) return null;
  try {
    return sourceFile.getPositionOfLineAndCharacter(line, column);
  } catch {
    return null;
  }
}

function findCallExpression(
  sourceFile: ts.SourceFile,
  position: number,
): ts.CallExpression | undefined {
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      position >= node.expression.getStart(sourceFile) &&
      position < node.expression.getEnd()
    )
      matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches.sort(
    (a, b) => a.getWidth(sourceFile) - b.getWidth(sourceFile),
  )[0];
}

function receiverExpression(
  expression: ts.LeftHandSideExpression,
): ts.Expression | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.expression;
  if (ts.isElementAccessExpression(expression)) return expression.expression;
  return null;
}

function classifyCallKind(
  expression: ts.LeftHandSideExpression,
  receiver: ts.Expression | null,
  binding: System1ImportBinding | null,
): System1CallKind {
  if (ts.isIdentifier(expression)) return SYSTEM1_CALL_KINDS.BARE;
  if (
    receiver &&
    (isThis(receiver) ||
      (ts.isPropertyAccessExpression(expression) &&
        isThis(expression.expression)))
  )
    return SYSTEM1_CALL_KINDS.THIS;
  if (receiver && ts.isCallExpression(receiver))
    return SYSTEM1_CALL_KINDS.ARG_CHAIN;
  if (binding?.kind === SYSTEM1_IMPORT_KINDS.NAMESPACE)
    return SYSTEM1_CALL_KINDS.NAMESPACE;
  return SYSTEM1_CALL_KINDS.MEMBER;
}

function findImportBinding(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): ImportSyntax | null {
  const root = rootIdentifier(call.expression);
  if (!root) return null;
  return (
    sourceFile.statements
      .map((statement) =>
        importBindingForRoot(statement, root.text, call.expression),
      )
      .find((binding) => binding !== null) ?? null
  );
}

function importBindingForRoot(
  statement: ts.Statement,
  root: string,
  callExpression: ts.Expression,
): ImportSyntax | null {
  if (
    !ts.isImportDeclaration(statement) ||
    !ts.isStringLiteral(statement.moduleSpecifier) ||
    !statement.importClause
  )
    return null;
  const specifier = statement.moduleSpecifier.text;
  return (
    defaultImportBinding(statement.importClause, root, specifier) ??
    namespaceImportBinding(
      statement.importClause,
      root,
      callExpression,
      specifier,
    ) ??
    namedImportBinding(statement.importClause, root, specifier)
  );
}

function defaultImportBinding(
  clause: ts.ImportClause,
  root: string,
  specifier: string,
): ImportSyntax | null {
  if (clause.name?.text !== root) return null;
  return {
    kind: SYSTEM1_IMPORT_KINDS.DEFAULT,
    local: clause.name.text,
    imported: "default",
    specifier,
  };
}

function namespaceImportBinding(
  clause: ts.ImportClause,
  root: string,
  callExpression: ts.Expression,
  specifier: string,
): ImportSyntax | null {
  const namedBindings = clause.namedBindings;
  if (
    !namedBindings ||
    !ts.isNamespaceImport(namedBindings) ||
    namedBindings.name.text !== root
  )
    return null;
  return {
    kind: SYSTEM1_IMPORT_KINDS.NAMESPACE,
    local: namedBindings.name.text,
    imported: importedNamespaceMember(callExpression, root),
    specifier,
  };
}

function namedImportBinding(
  clause: ts.ImportClause,
  root: string,
  specifier: string,
): ImportSyntax | null {
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return null;
  const found = bindings.elements.find((element) => element.name.text === root);
  if (!found) return null;
  return {
    kind: SYSTEM1_IMPORT_KINDS.NAMED,
    local: found.name.text,
    imported: (found.propertyName ?? found.name).text,
    specifier,
  };
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | null {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  )
    current = current.expression;
  return ts.isIdentifier(current) ? current : null;
}

function importedNamespaceMember(
  expression: ts.Expression,
  local: string,
): string {
  const parts: string[] = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  return ts.isIdentifier(current) && current.text === local
    ? parts.join(".")
    : "*";
}

function importBindings(sourceFile: ts.SourceFile): ImportSyntax[] {
  const bindings: ImportSyntax[] = [];
  for (const statement of sourceFile.statements)
    bindings.push(...bindingsFromStatement(statement));
  return bindings;
}

function bindingsFromStatement(statement: ts.Statement): ImportSyntax[] {
  if (
    !ts.isImportDeclaration(statement) ||
    !ts.isStringLiteral(statement.moduleSpecifier) ||
    !statement.importClause
  )
    return [];
  const clause = statement.importClause;
  const specifier = statement.moduleSpecifier.text;
  return [
    ...defaultBindingList(clause, specifier),
    ...namespaceBindingList(clause.namedBindings, specifier),
    ...namedBindingList(clause.namedBindings, specifier),
  ];
}

function defaultBindingList(
  clause: ts.ImportClause,
  specifier: string,
): ImportSyntax[] {
  if (!clause.name) return [];
  return [
    {
      kind: SYSTEM1_IMPORT_KINDS.DEFAULT,
      local: clause.name.text,
      imported: "default",
      specifier,
    },
  ];
}

function namespaceBindingList(
  namedBindings: ts.NamedImportBindings | undefined,
  specifier: string,
): ImportSyntax[] {
  if (!namedBindings || !ts.isNamespaceImport(namedBindings)) return [];
  return [
    {
      kind: SYSTEM1_IMPORT_KINDS.NAMESPACE,
      local: namedBindings.name.text,
      imported: "*",
      specifier,
    },
  ];
}

function namedBindingList(
  namedBindings: ts.NamedImportBindings | undefined,
  specifier: string,
): ImportSyntax[] {
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return [];
  return namedBindings.elements.map((element) => ({
    kind: SYSTEM1_IMPORT_KINDS.NAMED,
    local: element.name.text,
    imported: (element.propertyName ?? element.name).text,
    specifier,
  }));
}

function importedLocalNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  return new Set(importBindings(sourceFile).map((binding) => binding.local));
}

function localBindings(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (isOutOfScopeFunction(node, call)) return;
    collectFunctionParameterNames(node, call, names);
    collectVariableNames(node, call, sourceFile, names);
    collectBlockDeclarationName(node, call, sourceFile, names);
    collectCatchBindingName(node, call, names);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function isOutOfScopeFunction(node: ts.Node, call: ts.CallExpression): boolean {
  return ts.isFunctionLike(node) && !isAncestor(node, call);
}

function collectFunctionParameterNames(
  node: ts.Node,
  call: ts.CallExpression,
  names: Set<string>,
): void {
  if (!ts.isFunctionLike(node) || !isAncestor(node, call)) return;
  for (const parameter of node.parameters)
    collectBindingNames(parameter.name, names);
}

function collectVariableNames(
  node: ts.Node,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  names: Set<string>,
): void {
  if (
    ts.isVariableDeclaration(node) &&
    isAncestor(variableBindingScope(node, sourceFile), call)
  )
    collectBindingNames(node.name, names);
}

function collectBlockDeclarationName(
  node: ts.Node,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  names: Set<string>,
): void {
  if (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
    node.name &&
    isAncestor(blockBindingScope(node, sourceFile), call)
  )
    names.add(node.name.text);
}

function collectCatchBindingName(
  node: ts.Node,
  call: ts.CallExpression,
  names: Set<string>,
): void {
  if (
    ts.isCatchClause(node) &&
    isAncestor(node, call) &&
    node.variableDeclaration
  )
    collectBindingNames(node.variableDeclaration.name, names);
}

function isAncestor(ancestor: ts.Node, node: ts.Node): boolean {
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  )
    if (current === ancestor) return true;
  return false;
}

function variableBindingScope(
  declaration: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): ts.Node {
  const list = declaration.parent;
  const blockScoped = (list.flags & ts.NodeFlags.BlockScoped) !== 0;
  for (
    let current: ts.Node | undefined = list.parent;
    current && current !== sourceFile;
    current = current.parent
  ) {
    if (blockScoped && isBlockScope(current)) return current;
    if (!blockScoped && ts.isFunctionLike(current)) return current;
  }
  return sourceFile;
}

function blockBindingScope(
  declaration: ts.FunctionDeclaration | ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
): ts.Node {
  for (
    let current: ts.Node | undefined = declaration.parent;
    current && current !== sourceFile;
    current = current.parent
  )
    if (isBlockScope(current)) return current;
  return sourceFile;
}

function isBlockScope(node: ts.Node): boolean {
  return (
    ts.isBlock(node) ||
    ts.isSourceFile(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCatchClause(node)
  );
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) names.add(name.text);
  else
    for (const element of name.elements)
      if (ts.isBindingElement(element))
        collectBindingNames(element.name, names);
}

function simpleReceiverName(receiver: ts.Expression | null): string | null {
  if (!receiver) return null;
  if (ts.isIdentifier(receiver)) return receiver.text;
  return null;
}

function resolveThisFieldReceiver(
  receiver: ts.Expression | null,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): {
  readonly name: string;
  readonly typeHint: string | undefined;
  readonly typeNode: ts.TypeNode | undefined;
} | null {
  if (
    !receiver ||
    !ts.isPropertyAccessExpression(receiver) ||
    !isThis(receiver.expression)
  )
    return null;
  const name = receiver.name.text;
  const containingClass = findAncestor(call, ts.isClassLike);
  if (!containingClass)
    return { name, typeHint: undefined, typeNode: undefined };
  const parameterProperty = constructorParameterProperty(containingClass, name);
  if (parameterProperty)
    return typeFactsForParameter(name, parameterProperty, sourceFile);
  const memberProperty = classMemberProperty(containingClass, name);
  if (memberProperty)
    return typeFactsForMember(name, memberProperty, sourceFile);
  const constructorAssignment = findConstructorFieldAssignment(
    containingClass,
    name,
  );
  if (constructorAssignment)
    return {
      name,
      typeHint: syntacticTypeHint(undefined, constructorAssignment, sourceFile),
      typeNode: inferredTypeNode(constructorAssignment),
    };
  return { name, typeHint: undefined, typeNode: undefined };
}

function constructorParameterProperty(
  classNode: ts.ClassLikeDeclaration,
  name: string,
): ts.ParameterDeclaration | undefined {
  const constructor = classNode.members.find(ts.isConstructorDeclaration);
  return constructor?.parameters.find(
    (parameter) =>
      declarationNameText(parameter) === name && isParameterProperty(parameter),
  );
}

function typeFactsForParameter(
  name: string,
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
) {
  return {
    name,
    typeHint: syntacticTypeHint(
      parameter.type,
      parameter.initializer,
      sourceFile,
    ),
    typeNode: parameter.type ?? inferredTypeNode(parameter.initializer),
  };
}

function classMemberProperty(
  classNode: ts.ClassLikeDeclaration,
  name: string,
):
  | ts.PropertyDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | undefined {
  return classNode.members.find(
    (
      member,
    ): member is
      | ts.PropertyDeclaration
      | ts.GetAccessorDeclaration
      | ts.SetAccessorDeclaration =>
      (ts.isPropertyDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)) &&
      declarationNameText(member) === name,
  );
}

function typeFactsForMember(
  name: string,
  member:
    | ts.PropertyDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
  sourceFile: ts.SourceFile,
) {
  const initializer = ts.isPropertyDeclaration(member)
    ? member.initializer
    : undefined;
  return {
    name,
    typeHint: syntacticTypeHint(member.type, initializer, sourceFile),
    typeNode: member.type ?? inferredTypeNode(initializer),
  };
}

function findConstructorFieldAssignment(
  classNode: ts.ClassLikeDeclaration,
  fieldName: string,
): ts.Expression | undefined {
  const constructor = classNode.members.find(ts.isConstructorDeclaration);
  if (!constructor?.body) return undefined;
  const assignments: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      isThis(node.left.expression) &&
      node.left.name.text === fieldName
    )
      assignments.push(node.right);
    ts.forEachChild(node, visit);
  };
  visit(constructor.body);
  return assignments[0];
}

function inferredTypeNode(
  initializer: ts.Expression | undefined,
): ts.TypeNode | undefined {
  if (!initializer) return undefined;
  if (ts.isNewExpression(initializer))
    return ts.factory.createTypeReferenceNode(initializer.expression.getText());
  if (
    ts.isAsExpression(initializer) ||
    ts.isTypeAssertionExpression(initializer)
  )
    return initializer.type;
  if (ts.isSatisfiesExpression(initializer)) return initializer.type;
  if (ts.isParenthesizedExpression(initializer))
    return inferredTypeNode(initializer.expression);
  return undefined;
}

function syntacticTypeHint(
  type: ts.TypeNode | undefined,
  initializer: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (type) return type.getText(sourceFile);
  if (!initializer) return undefined;
  if (ts.isNewExpression(initializer))
    return initializer.expression.getText(sourceFile);
  if (
    ts.isAsExpression(initializer) ||
    ts.isTypeAssertionExpression(initializer)
  )
    return initializer.type.getText(sourceFile);
  if (ts.isSatisfiesExpression(initializer))
    return initializer.type.getText(sourceFile);
  if (ts.isParenthesizedExpression(initializer))
    return syntacticTypeHint(undefined, initializer.expression, sourceFile);
  return undefined;
}

function receiverTypeHint(
  receiver: ts.Expression | null,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  thisField: {
    readonly typeHint: string | undefined;
  } | null,
): { readonly typeHint: string | undefined; readonly known: boolean } | null {
  if (!receiver) return null;
  if (thisField)
    return {
      typeHint: thisField.typeHint,
      known: thisField.typeHint !== undefined,
    };
  if (ts.isIdentifier(receiver)) {
    const declaration = findReceiverDeclaration(
      receiver.text,
      call,
      sourceFile,
    );
    if (declaration) {
      const typeHint = syntacticTypeHint(
        declaration.type,
        declaration.initializer,
        sourceFile,
      );
      return { typeHint, known: typeHint !== undefined };
    }
    return { typeHint: undefined, known: false };
  }
  if (
    ts.isNewExpression(receiver) ||
    ts.isAsExpression(receiver) ||
    ts.isTypeAssertionExpression(receiver) ||
    ts.isSatisfiesExpression(receiver) ||
    ts.isParenthesizedExpression(receiver)
  ) {
    const typeHint = syntacticTypeHint(undefined, receiver, sourceFile);
    return { typeHint, known: typeHint !== undefined };
  }
  return null;
}

function findReceiverDeclaration(
  name: string,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.VariableDeclaration | ts.ParameterDeclaration | undefined {
  let found: ts.VariableDeclaration | ts.ParameterDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      isAncestor(variableBindingScope(node, sourceFile), call)
    ) {
      found = node;
      return;
    }
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      isAncestor(node.parent, call)
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function findAncestor<T extends ts.Node>(
  node: ts.Node,
  predicate: (candidate: ts.Node) => candidate is T,
): T | undefined {
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  )
    if (predicate(current)) return current;
  return undefined;
}

function isParameterProperty(parameter: ts.ParameterDeclaration): boolean {
  return (parameter.modifiers ?? []).some((modifier: ts.ModifierLike) => {
    const modifierKind = modifier.kind;
    return (
      modifierKind === ts.SyntaxKind.PublicKeyword ||
      modifierKind === ts.SyntaxKind.PrivateKeyword ||
      modifierKind === ts.SyntaxKind.ProtectedKeyword ||
      modifierKind === ts.SyntaxKind.ReadonlyKeyword
    );
  });
}

function isFluentChain(expression: ts.LeftHandSideExpression): boolean {
  if (
    !ts.isPropertyAccessExpression(expression) &&
    !ts.isElementAccessExpression(expression)
  )
    return false;
  let current: ts.Expression = expression.expression;
  let propertyDepth = 1;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    propertyDepth++;
    current = current.expression;
  }
  return ts.isCallExpression(expression.expression) || propertyDepth > 1;
}

function containingSymbol(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string {
  const names: string[] = [];
  for (
    let current: ts.Node | undefined = call.parent;
    current;
    current = current.parent
  ) {
    const name = namedNodeText(current);
    if (name) names.unshift(name);
    if (ts.isSourceFile(current)) break;
  }
  return names.join(".") || "<module>";
}

function boundedCallWindow(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): { readonly text: string; readonly truncated: boolean } {
  const start = sourceFile.getLineAndCharacterOfPosition(
    call.getStart(sourceFile),
  ).line;
  const end = sourceFile.getLineAndCharacterOfPosition(call.getEnd()).line;
  const firstLine = Math.max(0, start - SYSTEM1_CALL_SOURCE_LINES.BEFORE);
  const lastLine = Math.min(
    sourceFile.getLineStarts().length - 1,
    end + SYSTEM1_CALL_SOURCE_LINES.AFTER,
  );
  const sliceStart = sourceFile.getLineStarts()[firstLine] ?? 0;
  const sliceEnd =
    sourceFile.getLineStarts()[lastLine + 1] ?? sourceFile.text.length;
  const full = sourceFile.text.slice(sliceStart, sliceEnd).trim();
  if (Buffer.byteLength(full, "utf8") <= SYSTEM1_BYTE_LIMITS.SOURCE_WINDOW)
    return { text: full, truncated: false };
  const callOffset = call.getStart(sourceFile) - sliceStart;
  return {
    ...aroundUtf8(full, callOffset, SYSTEM1_BYTE_LIMITS.SOURCE_WINDOW),
    truncated: true,
  };
}

function aroundUtf8(
  text: string,
  centerOffset: number,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const points = Array.from(text);
  const centerIndex = Array.from(text.slice(0, centerOffset)).length;
  let left = centerIndex;
  let right = centerIndex;
  let bytes = 0;
  while (left > 0 || right < points.length) {
    const leftSize =
      left > 0 ? Buffer.byteLength(points[left - 1], "utf8") : Infinity;
    const rightSize =
      right < points.length
        ? Buffer.byteLength(points[right], "utf8")
        : Infinity;
    if (bytes + Math.min(leftSize, rightSize) > maxBytes) break;
    if (leftSize <= rightSize) {
      left--;
      bytes += leftSize;
    } else {
      bytes += rightSize;
      right++;
    }
  }
  return { text: points.slice(left, right).join(""), truncated: true };
}

function tierADeclarationKind(
  indexed: TierAIndexedDeclaration,
  selected: ts.Declaration,
): System1CandidateInput["declarationKind"] {
  const selectedKind = SYSTEM1_KIND_BY_TYPESCRIPT_NODE_KIND.get(selected.kind);
  if (selectedKind) return selectedKind;
  return (
    TIER_A_KIND_BY_NODE_TYPE.get(indexed.nodeType) ??
    SYSTEM1_DECLARATION_KINDS.UNKNOWN
  );
}

function describeTierADeclaration(
  filePath: string,
  indexed: TierAIndexedDeclaration,
  sourceFile: ts.SourceFile,
): Omit<
  System1CandidateInput,
  "id" | "targetId" | "tierARank" | "tierAEvidence"
> {
  const selected = findTypeScriptNodeForTierADeclaration(sourceFile, indexed);
  if (!selected) return missingCandidateSyntax();
  return {
    evidenceStatus: SYSTEM1_EVIDENCE_STATUSES.PRESENT,
    declarationKind: tierADeclarationKind(indexed, selected),
    signatureSnippet: signatureText(selected, sourceFile),
    overloadCount: declarationOverloadCount(sourceFile, indexed, selected),
    generatedMarker: hasGeneratedMarkerForDeclaration(
      filePath,
      sourceFile,
      selected,
    ),
    forwardingWrapper: isForwardingWrapper(selected, sourceFile),
  };
}

function declarationOverloadCount(
  sourceFile: ts.SourceFile,
  indexed: TierAIndexedDeclaration,
  selected: ts.Declaration,
): number | null {
  if (!isCallableDeclaration(selected)) return 1;
  return overloadDeclarationCount(sourceFile, indexed.name, selected);
}

function hasGeneratedMarkerForDeclaration(
  filePath: string,
  sourceFile: ts.SourceFile,
  selected: ts.Declaration,
): boolean {
  const fileName = filePath.split("/").at(-1) ?? "";
  const generatedPath = SYSTEM1_GENERATED_PATH_COMPONENTS.some((component) =>
    filePath
      .split("/")
      .some((part) => part.toLocaleLowerCase("en-US") === component),
  );
  const generatedName = SYSTEM1_GENERATED_FILE_MARKERS.some((marker) =>
    fileName.toLocaleLowerCase("en-US").includes(marker),
  );
  if (generatedPath || generatedName) return true;
  return hasGeneratedMarker(sourceFile.text, selected);
}

function findTypeScriptNodeForTierADeclaration(
  sourceFile: ts.SourceFile,
  indexed: TierAIndexedDeclaration,
): ts.Declaration | undefined {
  const exactRangeMatches: ts.Declaration[] = [];
  const exactNameMatches: ts.Declaration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      indexed.nameStartIndex !== null &&
      declarationNameNode(node as ts.Declaration)?.getStart(sourceFile) ===
        indexed.nameStartIndex
    )
      exactNameMatches.push(node as ts.Declaration);
    if (matchesTierAType(node, indexed.nodeType)) {
      const declaration = node as ts.Declaration;
      const start = declaration.getStart(sourceFile);
      const end = declaration.getEnd();
      if (start === indexed.startIndex && end === indexed.endIndex)
        exactRangeMatches.push(declaration);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (exactNameMatches.length === 1) return exactNameMatches[0];
  if (
    exactNameMatches.length > 1 ||
    indexed.name !== SYSTEM1_CONSTRUCTOR_SYMBOL_NAME
  )
    return undefined;
  return exactRangeMatches.length === 1 ? exactRangeMatches[0] : undefined;
}

function matchesTierAType(node: ts.Node, type: string): boolean {
  return TIER_A_TYPE_MATCHERS.get(type)?.(node) ?? false;
}

function namedDeclarations(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Declaration[] {
  const declarations: ts.Declaration[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isParameter(node) && declarationNameText(node) === name)
      declarations.push(node as ts.Declaration);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

function namedNodeText(node: ts.Node): string | undefined {
  return declarationNameText(node);
}

function declarationNameText(node: ts.Node): string | undefined {
  if (ts.isConstructorDeclaration(node)) return SYSTEM1_CONSTRUCTOR_SYMBOL_NAME;
  const name = declarationNameNode(node);
  if (!name) return undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return undefined;
}

function declarationNameNode(node: ts.Node): ts.Node | undefined {
  if (!DECLARATION_NAME_NODE_KINDS.has(node.kind) || !("name" in node))
    return undefined;
  return (node as ts.Node & { readonly name?: ts.Node }).name;
}

function isCallableDeclaration(node: ts.Declaration): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function overloadDeclarationCount(
  sourceFile: ts.SourceFile,
  name: string,
  selected: ts.Declaration,
): number {
  const container = trueDeclarationContainer(selected, sourceFile);
  return namedDeclarations(sourceFile, name).filter(
    (declaration) =>
      isCallableDeclaration(declaration) &&
      trueDeclarationContainer(declaration, sourceFile) === container,
  ).length;
}

function trueDeclarationContainer(
  declaration: ts.Declaration,
  sourceFile: ts.SourceFile,
): ts.Node {
  for (
    let current: ts.Node | undefined = declaration.parent;
    current;
    current = current.parent
  )
    if (
      ts.isClassLike(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeLiteralNode(current) ||
      ts.isObjectLiteralExpression(current) ||
      ts.isModuleDeclaration(current) ||
      ts.isFunctionLike(current) ||
      ts.isSourceFile(current)
    )
      return current;
  return sourceFile;
}

function missingCandidateSyntax(): Omit<
  System1CandidateInput,
  "id" | "targetId" | "tierARank" | "tierAEvidence"
> {
  return {
    evidenceStatus: SYSTEM1_EVIDENCE_STATUSES.MISSING,
    declarationKind: SYSTEM1_DECLARATION_KINDS.UNKNOWN,
    signatureSnippet: "",
    overloadCount: null,
    generatedMarker: null,
    forwardingWrapper: null,
  };
}

function signatureText(
  node: ts.Declaration,
  sourceFile: ts.SourceFile,
): string {
  const start = node.getStart(sourceFile);
  let end = node.getEnd();
  const body = "body" in node ? node.body : undefined;
  const members = "members" in node ? node.members : undefined;
  if (body && typeof body === "object" && "getStart" in body)
    end = (body as ts.Node).getStart(sourceFile);
  else if (members && typeof members === "object" && "pos" in members)
    end = (members as ts.NodeArray<ts.Node>).pos;
  return sourceFile.text.slice(start, end).trim();
}

function hasGeneratedMarker(text: string, declaration: ts.Node): boolean {
  const comments = [
    ...(ts.getLeadingCommentRanges(text, 0) ?? []),
    ...(ts.getLeadingCommentRanges(text, declaration.getFullStart()) ?? []),
  ];
  return comments.some((comment) =>
    GENERATED_MARKER.test(text.slice(comment.pos, comment.end)),
  );
}

function isForwardingWrapper(
  node: ts.Declaration,
  sourceFile: ts.SourceFile,
): boolean {
  const body = declarationBody(node);
  if (!body || body.statements.length !== 1) return false;
  const [statement] = body.statements;
  const call = forwardingCall(statement);
  if (!call || !isNamedNonBuiltinCall(call, sourceFile)) return false;
  const parameters = declarationParameters(node);
  const parameterNames = new Set(
    parameters.flatMap((parameter) => bindingNames(parameter.name)),
  );
  return call.arguments.some((argument) => {
    const passThrough = ts.isSpreadElement(argument)
      ? argument.expression
      : argument;
    return ts.isIdentifier(passThrough) && parameterNames.has(passThrough.text);
  });
}

function isNamedNonBuiltinCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const expression = call.expression;
  if (ts.isIdentifier(expression))
    return namedDeclarations(sourceFile, expression.text).some(
      (declaration) =>
        (ts.isFunctionDeclaration(declaration) ||
          ts.isFunctionExpression(declaration) ||
          ts.isVariableDeclaration(declaration)) &&
        declaration !== call.parent,
    );
  if (!ts.isPropertyAccessExpression(expression)) return false;
  const methodName = expression.name.text;
  const receiverTypes = expressionTypeNames(
    expression.expression,
    call,
    sourceFile,
  );
  if (
    receiverTypes.some((name) =>
      SYSTEM1_BUILTIN_TYPE_NAMES.includes(name as never),
    )
  )
    return false;
  if (
    SYSTEM1_BUILTIN_MEMBER_METHODS.includes(methodName as never) &&
    receiverTypes.length === 0
  )
    return false;
  return namedDeclarations(sourceFile, methodName).some(
    (declaration) =>
      ts.isMethodDeclaration(declaration) ||
      ts.isMethodSignature(declaration) ||
      ts.isFunctionDeclaration(declaration),
  );
}

function expressionTypeNames(
  expression: ts.Expression,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string[] {
  if (ts.isNewExpression(expression))
    return [expression.expression.getText(sourceFile)];
  const typeNode = expressionTypeNode(expression, call, sourceFile);
  if (typeNode && ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName)) return [typeName.text];
  }
  return [];
}

function expressionTypeNode(
  expression: ts.Expression,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  if (ts.isParenthesizedExpression(expression))
    return expressionTypeNode(expression.expression, call, sourceFile);
  const asserted = assertionTypeNode(expression);
  if (asserted) return asserted;
  const fieldType = thisFieldTypeNode(expression, call, sourceFile);
  if (fieldType) return fieldType;
  return identifierTypeNode(expression, call, sourceFile);
}

function assertionTypeNode(expression: ts.Expression): ts.TypeNode | undefined {
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression))
    return expression.type;
  return undefined;
}

function thisFieldTypeNode(
  expression: ts.Expression,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  if (
    ts.isPropertyAccessExpression(expression) &&
    isThis(expression.expression)
  )
    return resolveThisFieldReceiver(expression, call, sourceFile)?.typeNode;
  return undefined;
}

function identifierTypeNode(
  expression: ts.Expression,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  if (!ts.isIdentifier(expression)) return undefined;
  const declaration = findReceiverDeclaration(
    expression.text,
    call,
    sourceFile,
  );
  return declaration?.type ?? inferredTypeNode(declaration?.initializer);
}

function forwardingCall(statement: ts.Statement): ts.CallExpression | null {
  let expression: ts.Expression | undefined;
  if (ts.isReturnStatement(statement)) expression = statement.expression;
  else if (ts.isExpressionStatement(statement))
    expression = statement.expression;
  if (expression && ts.isAwaitExpression(expression))
    expression = expression.expression;
  return expression && ts.isCallExpression(expression) ? expression : null;
}

function declarationParameters(
  node: ts.Declaration,
): readonly ts.ParameterDeclaration[] {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
    return node.parameters;
  if (ts.isVariableDeclaration(node)) {
    const initializer = node.initializer;
    if (
      initializer &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    )
      return initializer.parameters;
  }
  return [];
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : [],
  );
}

function declarationBody(node: ts.Declaration): ts.Block | undefined {
  if (isDeclarationWithBody(node)) return node.body;
  if (!ts.isVariableDeclaration(node)) return undefined;
  return blockBody(node.initializer);
}

function isDeclarationWithBody(
  node: ts.Declaration,
): node is
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function blockBody(
  initializer: ts.Expression | undefined,
): ts.Block | undefined {
  if (
    !initializer ||
    (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))
  )
    return undefined;
  return ts.isBlock(initializer.body) ? initializer.body : undefined;
}

function matchesConfiguredPathAlias(
  specifier: string,
  paths: ts.CompilerOptions["paths"],
): boolean {
  if (!paths) return false;
  return Object.keys(paths).some((pattern) => {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) return specifier === pattern;
    const prefix = pattern.slice(0, wildcard);
    const suffix = pattern.slice(wildcard + 1);
    return specifier.startsWith(prefix) && specifier.endsWith(suffix);
  });
}

function moduleReexportsBindings(sourceFile: ts.SourceFile): boolean {
  const imported = new Set(
    importBindings(sourceFile).map((binding) => binding.local),
  );
  return sourceFile.statements.some((statement) => {
    if (!ts.isExportDeclaration(statement)) return false;
    if (statement.moduleSpecifier) return true;
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
      return false;
    return statement.exportClause.elements.some((element) =>
      imported.has((element.propertyName ?? element.name).text),
    );
  });
}

function boundedComputedImport(sourceFile: ts.SourceFile): boolean {
  const literals = new Map<string, string>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const literal = staticString(node.initializer, literals);
      if (literal !== null) literals.set(node.name.text, literal);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const [argument] = node.arguments;
      if (
        ts.isTemplateExpression(argument) ||
        ts.isBinaryExpression(argument)
      ) {
        const value = staticString(argument, literals);
        if (
          value !== null &&
          Buffer.byteLength(value, "utf8") <= SYSTEM1_BOUNDED_IMPORT_MAX_BYTES
        )
          found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function staticString(
  expression: ts.Expression,
  literals: ReadonlyMap<string, string>,
): string | null {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (ts.isIdentifier(expression)) return literals.get(expression.text) ?? null;
  if (ts.isTemplateExpression(expression))
    return staticTemplateString(expression, literals);
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return staticConcatenatedString(expression, literals);
  return null;
}

function staticTemplateString(
  expression: ts.TemplateExpression,
  literals: ReadonlyMap<string, string>,
): string | null {
  let value = expression.head.text;
  for (const span of expression.templateSpans) {
    const part = staticString(span.expression, literals);
    if (part === null) return null;
    value += part + span.literal.text;
  }
  return value;
}

function staticConcatenatedString(
  expression: ts.BinaryExpression,
  literals: ReadonlyMap<string, string>,
): string | null {
  const left = staticString(expression.left, literals);
  const right = staticString(expression.right, literals);
  return left === null || right === null ? null : left + right;
}

function hasKnownFrameworkDecorator(
  sourceFile: ts.SourceFile,
  root: ts.Node,
): boolean {
  const namedImports = new Map<string, string>();
  for (const binding of importBindings(sourceFile))
    namedImports.set(binding.local, binding.specifier);
  if (!ts.canHaveDecorators(root)) return false;
  return (ts.getDecorators(root) ?? []).some((decorator) => {
    const expression = decorator.expression;
    const callee = ts.isCallExpression(expression)
      ? expression.expression
      : expression;
    if (!ts.isIdentifier(callee)) return false;
    const specifier = namedImports.get(callee.text);
    return (
      SYSTEM1_FRAMEWORK_DECORATORS.includes(
        callee.text as (typeof SYSTEM1_FRAMEWORK_DECORATORS)[number],
      ) &&
      specifier !== undefined &&
      SYSTEM1_FRAMEWORK_PACKAGES.some((prefix) => specifier.startsWith(prefix))
    );
  });
}

function isFrameworkRegistryLookup(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const method = call.expression.name.text.toLowerCase();
  const receiver = call.expression.expression;
  if (
    !SYSTEM1_FRAMEWORK_REGISTRY_METHODS.some(
      (candidate) => candidate.toLowerCase() === method,
    )
  )
    return false;
  const receiverName = ts.isIdentifier(receiver)
    ? receiver.text
    : resolveThisFieldReceiver(receiver, call, sourceFile)?.name;
  if (!receiverName) return false;
  return SYSTEM1_FRAMEWORK_REGISTRIES.some((registry) => {
    if (registry.receiver !== receiverName) return false;
    const typeBindings = importBindings(sourceFile).filter(
      (binding) =>
        binding.imported === registry.type &&
        binding.specifier === registry.sourceSpecifier,
    );
    return typeBindings.some((binding) =>
      receiverTypeNames(receiver, call, sourceFile).has(binding.local),
    );
  });
}

function receiverTypeNames(
  receiver: ts.Expression,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const names = new Set<string>();
  const thisField = resolveThisFieldReceiver(receiver, call, sourceFile);
  if (thisField?.typeNode) addTypeReferenceName(thisField.typeNode, names);
  if (!ts.isIdentifier(receiver)) return names;
  const declaration = findReceiverDeclaration(receiver.text, call, sourceFile);
  const typeNode =
    declaration?.type ?? inferredTypeNode(declaration?.initializer);
  if (typeNode) addTypeReferenceName(typeNode, names);
  return names;
}

function addTypeReferenceName(typeNode: ts.TypeNode, names: Set<string>): void {
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName))
    names.add(typeNode.typeName.text);
}

function isCallOnInjectedMember(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const containingClass = findAncestor(call, ts.isClassLike);
  if (
    !containingClass ||
    !hasKnownFrameworkDecorator(sourceFile, containingClass)
  )
    return false;
  const field = resolveThisFieldReceiver(
    receiverExpression(call.expression),
    call,
    sourceFile,
  );
  if (!field) return false;
  return containingClass.members.some((member) => {
    if (
      (ts.isPropertyDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)) &&
      declarationNameText(member) === field.name
    )
      return hasKnownFrameworkDecorator(sourceFile, member);
    if (ts.isConstructorDeclaration(member))
      return member.parameters.some(
        (parameter) =>
          declarationNameText(parameter) === field.name &&
          isParameterProperty(parameter) &&
          (parameter.type !== undefined ||
            hasKnownFrameworkDecorator(sourceFile, parameter)),
      );
    return false;
  });
}

function isThis(expression: ts.Expression): boolean {
  return expression.kind === ts.SyntaxKind.ThisKeyword;
}
