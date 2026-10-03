import type { Node } from "web-tree-sitter";
import {
  AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
  type AstCallCalleeBinding,
  type AstCallArgumentKind,
  type AstCallReceiverBinding,
  type AstCallSiteShapeFact,
  type AstCallSiteShapeFacts,
  type AstImportDescriptor,
  type AstDeclaredTypeLanguage,
  type AstUtf16Span,
} from "@workspace/contracts";

const CALLABLE_SCOPE_TYPES = new Set([
  "arrow_function",
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
]);
const CLASS_TYPES = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "class",
]);
const NAMED_SHADOW_DECLARATION_TYPES = new Set([
  "class",
  "class_declaration",
  "abstract_class_declaration",
  "function_expression",
  "function_declaration",
  "generator_function",
  "generator_function_declaration",
]);
const TYPE_SIGNATURE_TYPES = new Set([
  "function_type",
  "constructor_type",
  "call_signature",
  "construct_signature",
  "index_signature",
  "object_type",
]);
const FOR_SCOPE_TYPES = new Set([
  "for_statement",
  "for_in_statement",
  "for_of_statement",
  "for_await_statement",
]);
const BINDING_PATTERN_TYPES = new Set([
  "object_pattern",
  "array_pattern",
  "pair_pattern",
  "assignment_pattern",
  "object_assignment_pattern",
  "rest_pattern",
]);
const SIMPLE_IDENTIFIER = /^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u;

interface WorkerCallSite {
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeName?: string;
  readonly receiverText?: string;
  readonly calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
}

type SupportedWorkerCallSite = WorkerCallSite & {
  readonly calleeName: string;
  readonly calleeKind?: "bare" | "member" | "this" | "arg-chain";
};

interface PendingFact {
  readonly fact: Omit<AstCallSiteShapeFact, "peerMemberNames">;
  readonly peerKey: string | null;
}

interface IndexedBinding {
  readonly name: string;
  readonly declarationSpan: AstUtf16Span;
  readonly scopeSpan: AstUtf16Span;
  readonly kind:
    | AstCallReceiverBinding["kind"]
    | "import"
    | "type-only-import"
    | "unsupported";
}

interface ShapeIndexes {
  readonly callExpressions: ReadonlyMap<string, readonly Node[]>;
  readonly bindingsByScope: ReadonlyMap<
    string,
    ReadonlyMap<string, IndexedBinding>
  >;
  readonly propertiesByClassAndName: ReadonlyMap<
    string,
    AstCallReceiverBinding | null
  >;
}

function span(node: Node): AstUtf16Span {
  return { start: node.startIndex, end: node.endIndex };
}

function namedChildren(node: Node): Node[] {
  const result: Node[] = [];
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child) result.push(child);
  }
  return result;
}

function allChildren(node: Node): Node[] {
  const result: Node[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) result.push(child);
  }
  return result;
}

function walk(node: Node, visit: (current: Node) => void): void {
  visit(node);
  for (const child of namedChildren(node)) walk(child, visit);
}

function ancestor(
  node: Node | null,
  accepts: (current: Node) => boolean,
): Node | null {
  let current = node;
  while (current) {
    if (accepts(current)) return current;
    current = current.parent;
  }
  return null;
}

function bindingName(node: Node): string | null {
  const name =
    node.childForFieldName("name") ??
    node.childForFieldName("pattern") ??
    node.childForFieldName("declarator");
  return name?.type === "identifier" ? name.text : null;
}

function nearestScope(
  node: Node,
  accepts: (current: Node) => boolean,
  root: Node,
): Node {
  return ancestor(node.parent, accepts) ?? root;
}

function declarationKind(node: Node): string | undefined {
  return node.parent?.text.trimStart().match(/^(var|let|const)\b/)?.[1];
}

function bindingScope(node: Node, root: Node): Node {
  if (node.type === "required_parameter" || node.type === "optional_parameter")
    return nearestScope(
      node,
      (current) => CALLABLE_SCOPE_TYPES.has(current.type),
      root,
    );
  const kind = declarationKind(node);
  if (kind === "var")
    return nearestScope(
      node,
      (current) => CALLABLE_SCOPE_TYPES.has(current.type),
      root,
    );
  const forScope = ancestor(node.parent, (current) =>
    FOR_SCOPE_TYPES.has(current.type),
  );
  if (forScope) return forScope;
  return nearestScope(
    node,
    (current) => current.type === "statement_block",
    root,
  );
}

function lexicalScope(node: Node, root: Node): Node {
  return (
    ancestor(node.parent, (current) =>
      CALLABLE_SCOPE_TYPES.has(current.type),
    ) ?? root
  );
}

function classThisOwner(node: Node): Node | null {
  let current = node.parent;
  while (current) {
    if (CLASS_TYPES.has(current.type)) return current;
    if (current.type === "arrow_function") {
      current = current.parent;
      continue;
    }
    if (
      CALLABLE_SCOPE_TYPES.has(current.type) &&
      !(
        current.type === "method_definition" &&
        current.parent?.type === "class_body"
      )
    )
      return null;
    current = current.parent;
  }
  return null;
}

function callerType(node: Node): AstCallSiteShapeFact["callerType"] {
  const owner = classThisOwner(node);
  const name = owner?.childForFieldName("name")?.text;
  return owner && name ? { name, span: span(owner) } : null;
}

function fieldBinding(
  propertyName: string,
  classNode: Node,
  member: Node,
): AstCallReceiverBinding | null {
  if (
    (member.type !== "public_field_definition" &&
      member.type !== "field_definition") ||
    member.childForFieldName("name")?.text !== propertyName
  )
    return null;
  return {
    kind: "field",
    name: propertyName,
    declarationSpan: span(member),
    scopeSpan: span(classNode),
  };
}

function patternNames(node: Node): string[] {
  if (node.type === "identifier") return [node.text];
  if (
    node.type === "shorthand_property_identifier_pattern" ||
    node.type === "shorthand_property_identifier"
  )
    return [node.text];
  if (!BINDING_PATTERN_TYPES.has(node.type)) return [];
  return namedChildren(node).flatMap(patternNames);
}

function addBinding(
  index: Map<string, Map<string, IndexedBinding>>,
  node: Node,
  scope: Node,
  kind: IndexedBinding["kind"],
  names: readonly string[],
): void {
  const key = scopeIndexKey(scope);
  const bindings = index.get(key) ?? new Map<string, IndexedBinding>();
  for (const name of names) {
    const existing = bindings.get(name);
    if (existing) {
      if (
        existing.declarationSpan.start !== node.startIndex ||
        existing.declarationSpan.end !== node.endIndex
      )
        bindings.set(name, { ...existing, kind: "unsupported" });
      continue;
    }
    bindings.set(name, {
      name,
      declarationSpan: span(node),
      scopeSpan: span(scope),
      kind,
    });
  }
  index.set(key, bindings);
}

function indexCallableBinding(
  node: Node,
  root: Node,
  index: Map<string, Map<string, IndexedBinding>>,
): void {
  if (
    ancestor(node.parent, (current) => TYPE_SIGNATURE_TYPES.has(current.type))
  )
    return;
  const pattern =
    node.childForFieldName("name") ??
    node.childForFieldName("pattern") ??
    node.childForFieldName("declarator");
  if (!pattern) return;
  const names = patternNames(pattern);
  const simple = pattern.type === "identifier";
  const loopBinding = ancestor(node.parent, (current) =>
    FOR_SCOPE_TYPES.has(current.type),
  );
  const kind: IndexedBinding["kind"] =
    simple &&
    (node.type === "required_parameter" || node.type === "optional_parameter")
      ? "parameter"
      : loopBinding
        ? "unsupported"
        : simple
          ? "local"
          : "unsupported";
  addBinding(index, node, bindingScope(node, root), kind, names);
}

function indexDirectCallableParameters(
  node: Node,
  index: Map<string, Map<string, IndexedBinding>>,
): void {
  if (!CALLABLE_SCOPE_TYPES.has(node.type)) return;
  const parameters = node.childForFieldName("parameters");
  const directParameter = node.childForFieldName("parameter");
  const candidates = parameters
    ? namedChildren(parameters)
    : directParameter
      ? [directParameter]
      : [];
  for (const parameter of candidates) {
    if (
      parameter.type === "required_parameter" ||
      parameter.type === "optional_parameter"
    )
      continue;
    const names = patternNames(parameter);
    if (names.length === 0) continue;
    const simple = parameter.type === "identifier";
    addBinding(
      index,
      parameter,
      node,
      simple ? "parameter" : "unsupported",
      names,
    );
  }
}

function indexNamedDeclarationShadow(
  node: Node,
  root: Node,
  index: Map<string, Map<string, IndexedBinding>>,
): void {
  if (!NAMED_SHADOW_DECLARATION_TYPES.has(node.type)) return;
  const name = node.childForFieldName("name");
  if (name?.type !== "identifier" && name?.type !== "type_identifier") return;
  const ownNameScope =
    node.type === "class" ||
    node.type === "function_expression" ||
    node.type === "generator_function";
  const scope = ownNameScope
    ? node
    : nearestScope(node, (current) => current.type === "statement_block", root);
  addBinding(index, name, scope, "unsupported", [name.text]);
}

function indexCatchBinding(
  node: Node,
  index: Map<string, Map<string, IndexedBinding>>,
): void {
  if (node.type !== "catch_clause") return;
  const parameter = node.childForFieldName("parameter");
  if (!parameter) return;
  const body = node.childForFieldName("body") ?? node;
  addBinding(index, parameter, body, "unsupported", patternNames(parameter));
}

function indexLoopBinding(
  node: Node,
  index: Map<string, Map<string, IndexedBinding>>,
): void {
  if (!FOR_SCOPE_TYPES.has(node.type)) return;
  const declaration =
    node.childForFieldName("left") ?? node.childForFieldName("initializer");
  if (!declaration) return;
  const declarator =
    declaration.type === "variable_declaration"
      ? namedChildren(declaration).find(
          (child) => child.type === "variable_declarator",
        )
      : declaration;
  const pattern =
    declarator?.type === "variable_declarator"
      ? declarator.childForFieldName("name")
      : declarator;
  if (!pattern) return;
  addBinding(index, pattern, node, "unsupported", patternNames(pattern));
}

function indexImportBindings(
  root: Node,
  imports: readonly AstImportDescriptor[],
  index: Map<string, Map<string, IndexedBinding>>,
): void {
  const bindings = index.get(scopeIndexKey(root)) ?? new Map();
  for (const [name, descriptors] of groupImportBindings(imports))
    setImportBinding(root, bindings, name, descriptors);
  index.set(scopeIndexKey(root), bindings);
}

function groupImportBindings(
  imports: readonly AstImportDescriptor[],
): Map<string, AstImportDescriptor[]> {
  const importsByName = new Map<string, AstImportDescriptor[]>();
  for (const descriptor of imports) {
    if (descriptor.viaReexport) continue;
    const matches = importsByName.get(descriptor.localName) ?? [];
    matches.push(descriptor);
    importsByName.set(descriptor.localName, matches);
  }
  return importsByName;
}

function setImportBinding(
  root: Node,
  bindings: Map<string, IndexedBinding>,
  name: string,
  descriptors: readonly AstImportDescriptor[],
): void {
  const existing = bindings.get(name);
  const scopeSpan = span(root);
  if (descriptors.length !== 1 || existing) {
    bindings.set(name, {
      name,
      declarationSpan: existing?.declarationSpan ?? scopeSpan,
      scopeSpan,
      kind: "unsupported",
    });
    return;
  }
  bindings.set(name, {
    name,
    declarationSpan: scopeSpan,
    scopeSpan,
    kind: descriptors[0]?.isTypeOnly ? "type-only-import" : "import",
  });
}

function buildBindingIndex(
  root: Node,
  imports: readonly AstImportDescriptor[],
): Map<string, Map<string, IndexedBinding>> {
  const index = new Map<string, Map<string, IndexedBinding>>();
  walk(root, (node) => {
    if (
      node.type === "required_parameter" ||
      node.type === "optional_parameter" ||
      node.type === "variable_declarator"
    )
      indexCallableBinding(node, root, index);
    indexDirectCallableParameters(node, index);
    indexNamedDeclarationShadow(node, root, index);
    indexCatchBinding(node, index);
    indexLoopBinding(node, index);
  });
  indexImportBindings(root, imports, index);
  return index;
}

function propertyIndexKey(classNode: Node, name: string): string {
  return `${classNode.startIndex}:${name}`;
}

function scopeIndexKey(node: Node): string {
  return `${node.type}:${node.startIndex}:${node.endIndex}`;
}

function setPropertyBinding(
  index: Map<string, AstCallReceiverBinding | null>,
  key: string,
  binding: AstCallReceiverBinding,
): void {
  index.set(key, index.has(key) ? null : binding);
}

function hasParameterPropertyModifier(node: Node): boolean {
  return allChildren(node).some(
    (child) =>
      child.type === "accessibility_modifier" || child.text === "readonly",
  );
}

function indexConstructorProperties(
  classNode: Node,
  member: Node,
  index: Map<string, AstCallReceiverBinding | null>,
): void {
  if (
    member.type !== "method_definition" ||
    member.childForFieldName("name")?.text !== "constructor"
  )
    return;
  const parameters = member.childForFieldName("parameters");
  for (const parameter of parameters ? namedChildren(parameters) : []) {
    const property = bindingName(parameter);
    if (!property || !hasParameterPropertyModifier(parameter)) continue;
    setPropertyBinding(index, propertyIndexKey(classNode, property), {
      kind: "parameter-property",
      name: property,
      declarationSpan: span(parameter),
      scopeSpan: span(classNode),
    });
  }
}

function indexClassProperties(
  classNode: Node,
  index: Map<string, AstCallReceiverBinding | null>,
): void {
  const body = classNode.childForFieldName("body");
  for (const member of body ? namedChildren(body) : []) {
    const name = member.childForFieldName("name")?.text;
    const field = name ? fieldBinding(name, classNode, member) : null;
    if (field)
      setPropertyBinding(index, propertyIndexKey(classNode, name!), field);
    indexConstructorProperties(classNode, member, index);
  }
}

function buildPropertyIndex(
  root: Node,
): Map<string, AstCallReceiverBinding | null> {
  const index = new Map<string, AstCallReceiverBinding | null>();
  walk(root, (node) => {
    if (CLASS_TYPES.has(node.type)) indexClassProperties(node, index);
  });
  return index;
}

function callSiteIndexKey(row: number, column: number, name: string): string {
  return `${row}:${column}:${name}`;
}

function buildShapeIndexes(
  root: Node,
  imports: readonly AstImportDescriptor[],
): ShapeIndexes {
  const calls = new Map<string, Node[]>();
  walk(root, (node) => {
    if (node.type !== "call_expression") return;
    const callee = node.childForFieldName("function");
    if (!callee) return;
    const position =
      callee.childForFieldName("property") ??
      callee.childForFieldName("name") ??
      callee;
    const name = callee.childForFieldName("property")?.text ?? callee.text;
    const key = callSiteIndexKey(
      position.startPosition.row,
      position.startPosition.column,
      name,
    );
    calls.set(key, [...(calls.get(key) ?? []), node]);
  });
  return {
    callExpressions: calls,
    bindingsByScope: buildBindingIndex(root, imports),
    propertiesByClassAndName: buildPropertyIndex(root),
  };
}

function resolveThisReceiverBinding(
  receiverText: string,
  call: Node,
  indexes: ShapeIndexes,
): AstCallReceiverBinding | null | undefined {
  const owner = classThisOwner(call);
  if (receiverText === "this")
    return owner
      ? {
          kind: "this",
          name: "this",
          declarationSpan: span(owner),
          scopeSpan: span(owner),
        }
      : null;
  const property = receiverText.match(
    /^this\.([\p{ID_Start}_$][\p{ID_Continue}$]*)$/u,
  );
  if (!property) return undefined;
  return owner
    ? (indexes.propertiesByClassAndName.get(
        propertyIndexKey(owner, property[1]),
      ) ?? null)
    : null;
}

function resolveReceiverBinding(
  receiverText: string | undefined,
  call: Node,
  indexes: ShapeIndexes,
): AstCallReceiverBinding | null {
  if (!receiverText) return null;
  const thisBinding = resolveThisReceiverBinding(receiverText, call, indexes);
  if (thisBinding !== undefined) return thisBinding;
  if (!SIMPLE_IDENTIFIER.test(receiverText)) return null;
  const binding = findLexicalBinding(receiverText, call, indexes);
  return binding ? bindingResult(receiverText, binding) : null;
}

function findLexicalBinding(
  name: string,
  node: Node,
  indexes: ShapeIndexes,
): IndexedBinding | undefined {
  let current: Node | null = node;
  while (current) {
    const binding = indexes.bindingsByScope
      .get(scopeIndexKey(current))
      ?.get(name);
    if (binding) return binding;
    current = current.parent;
  }
  return undefined;
}

function bindingResult(
  name: string,
  candidate: IndexedBinding | null,
): AstCallReceiverBinding | null {
  if (
    !candidate ||
    candidate.kind === "unsupported" ||
    candidate.kind === "import" ||
    candidate.kind === "type-only-import"
  )
    return null;
  return {
    kind: candidate.kind,
    name,
    declarationSpan: candidate.declarationSpan,
    scopeSpan: candidate.scopeSpan,
  };
}

function calleeBinding(
  record: SupportedWorkerCallSite,
  call: Node,
  indexes: ShapeIndexes,
): AstCallCalleeBinding | null {
  const kind = record.calleeKind ?? "bare";
  if (kind !== "bare") return null;
  const name = record.calleeName;
  const binding = findLexicalBinding(name, call, indexes);
  if (!binding) return { kind: "unbound", name };
  const bindingKind =
    binding.kind === "import" ||
    binding.kind === "type-only-import" ||
    binding.kind === "local" ||
    binding.kind === "parameter"
      ? binding.kind
      : "unsupported";
  return {
    kind: bindingKind,
    name,
    declarationSpan: binding.declarationSpan,
    scopeSpan: binding.scopeSpan,
  };
}

function argumentKind(node: Node): AstCallArgumentKind {
  switch (node.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "true":
    case "false":
      return "boolean";
    case "null":
      return "null";
    case "object":
      return "object";
    case "array":
      return "array";
    case "arrow_function":
    case "function_expression":
      return "function";
    default:
      return "unknown";
  }
}

function peerKey(
  scope: AstUtf16Span,
  binding: AstCallReceiverBinding | null,
): string | null {
  if (!binding) return null;
  return [
    scope.start,
    scope.end,
    binding.kind,
    binding.declarationSpan.start,
    binding.declarationSpan.end,
    binding.scopeSpan.start,
    binding.scopeSpan.end,
  ].join(":");
}

function findCall(record: WorkerCallSite, indexes: ShapeIndexes): Node | null {
  if (!record.calleeName || record.calleeKind === "computed") return null;
  const calls = indexes.callExpressions.get(
    callSiteIndexKey(record.startLine, record.startColumn, record.calleeName),
  );
  return calls?.length === 1 ? (calls[0] ?? null) : null;
}

function isSupportedCall(
  record: WorkerCallSite,
): record is SupportedWorkerCallSite {
  return Boolean(record.calleeName) && record.calleeKind !== "computed";
}

function pendingForCall(
  record: SupportedWorkerCallSite,
  call: Node,
  root: Node,
  indexes: ShapeIndexes,
): PendingFact {
  const argsNode = call.childForFieldName("arguments");
  const args = argsNode
    ? namedChildren(argsNode).filter((argument) => argument.type !== "comment")
    : [];
  const hasSpreadArgument = args.some(
    (argument) => argument.type === "spread_element",
  );
  const scope = lexicalScope(call, root);
  const binding = resolveReceiverBinding(record.receiverText, call, indexes);
  const callBinding = calleeBinding(record, call, indexes);
  const fact: Omit<AstCallSiteShapeFact, "peerMemberNames"> = {
    startLine: record.startLine,
    startColumn: record.startColumn,
    calleeName: record.calleeName ?? "",
    calleeKind: record.calleeKind ?? "bare",
    receiverText: record.receiverText ?? null,
    receiverBinding: binding,
    calleeBinding: callBinding,
    lexicalScopeSpan: span(scope),
    callerType: callerType(call),
    argumentCount: hasSpreadArgument ? null : args.length,
    hasSpreadArgument,
    argumentKinds: args.map(argumentKind),
  };
  return { fact, peerKey: peerKey(fact.lexicalScopeSpan, binding) };
}

function addPeerName(
  namesByPeer: Map<string, Set<string>>,
  fact: Omit<AstCallSiteShapeFact, "peerMemberNames">,
  key: string | null,
): void {
  if (!key || (fact.calleeKind !== "member" && fact.calleeKind !== "this"))
    return;
  const names = namesByPeer.get(key) ?? new Set<string>();
  names.add(fact.calleeName);
  namesByPeer.set(key, names);
}

/** Extracts real TS/JS call syntax into additive, binding-scoped facts. */
export function extractCallSiteShapeFacts(
  root: Node,
  language: AstDeclaredTypeLanguage,
  calls: readonly WorkerCallSite[],
  imports: readonly AstImportDescriptor[],
): AstCallSiteShapeFacts {
  const indexes = buildShapeIndexes(root, imports);
  const pending = calls.flatMap((record) => {
    if (!isSupportedCall(record)) return [];
    const call = findCall(record, indexes);
    return call ? [pendingForCall(record, call, root, indexes)] : [];
  });
  const namesByPeer = new Map<string, Set<string>>();
  for (const { fact, peerKey: key } of pending) {
    addPeerName(namesByPeer, fact, key);
  }
  const callSites = pending.map(({ fact, peerKey: key }) => ({
    ...fact,
    peerMemberNames: [...(key ? (namesByPeer.get(key) ?? []) : [])]
      .filter((name) => name !== fact.calleeName)
      .sort(),
  }));
  return {
    schemaVersion: AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
    language,
    callSites,
  };
}
