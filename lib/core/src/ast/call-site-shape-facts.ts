import type { Node } from "web-tree-sitter";
import {
  AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
  type AstCallArgumentKind,
  type AstCallReceiverBinding,
  type AstCallSiteShapeFact,
  type AstCallSiteShapeFacts,
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

function bindingScope(node: Node, root: Node): Node {
  if (
    node.type === "required_parameter" ||
    node.type === "optional_parameter"
  ) {
    return (
      ancestor(node.parent, (current) =>
        CALLABLE_SCOPE_TYPES.has(current.type),
      ) ?? root
    );
  }
  const declaration = node.parent;
  const declarationKind = declaration?.text
    .trimStart()
    .match(/^(var|let|const)\b/)?.[1];
  if (declarationKind === "var")
    return (
      ancestor(node.parent, (current) =>
        CALLABLE_SCOPE_TYPES.has(current.type),
      ) ?? root
    );
  return (
    ancestor(node.parent, (current) => current.type === "statement_block") ??
    root
  );
}

function lexicalScope(node: Node, root: Node): Node {
  return (
    ancestor(node.parent, (current) =>
      CALLABLE_SCOPE_TYPES.has(current.type),
    ) ?? root
  );
}

function callerType(node: Node): AstCallSiteShapeFact["callerType"] {
  const owner = ancestor(node.parent, (current) =>
    CLASS_TYPES.has(current.type),
  );
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

function parameterPropertyBinding(
  propertyName: string,
  classNode: Node,
  member: Node,
): AstCallReceiverBinding | null {
  if (
    member.type !== "method_definition" ||
    member.childForFieldName("name")?.text !== "constructor"
  )
    return null;
  const parameters = member.childForFieldName("parameters");
  const parameter = (parameters ? namedChildren(parameters) : []).find(
    (candidate) =>
      bindingName(candidate) === propertyName &&
      /\b(private|protected|public)\b/.test(candidate.text),
  );
  return parameter
    ? {
        kind: "parameter-property",
        name: propertyName,
        declarationSpan: span(parameter),
        scopeSpan: span(classNode),
      }
    : null;
}

function propertyBinding(
  propertyName: string,
  classNode: Node,
): AstCallReceiverBinding | null {
  const body = classNode.childForFieldName("body");
  for (const member of body ? namedChildren(body) : []) {
    const binding =
      fieldBinding(propertyName, classNode, member) ??
      parameterPropertyBinding(propertyName, classNode, member);
    if (binding) return binding;
  }
  return null;
}

function resolveReceiverBinding(
  receiverText: string | undefined,
  call: Node,
  root: Node,
): AstCallReceiverBinding | null {
  if (!receiverText) return null;
  if (receiverText === "this") {
    const classNode = ancestor(call.parent, (current) =>
      CLASS_TYPES.has(current.type),
    );
    return classNode
      ? {
          kind: "this",
          name: "this",
          declarationSpan: span(classNode),
          scopeSpan: span(classNode),
        }
      : null;
  }
  if (receiverText.startsWith("this.")) {
    const match = receiverText.match(
      /^this\.([\p{ID_Start}_$][\p{ID_Continue}$]*)$/u,
    );
    const classNode = ancestor(call.parent, (current) =>
      CLASS_TYPES.has(current.type),
    );
    return match && classNode ? propertyBinding(match[1], classNode) : null;
  }
  if (!SIMPLE_IDENTIFIER.test(receiverText)) return null;

  const callOffset = call.startIndex;
  const matches: Array<{
    readonly node: Node;
    readonly scope: Node;
    readonly kind: "parameter" | "local";
  }> = [];
  walk(root, (node) => {
    if (
      node.type !== "required_parameter" &&
      node.type !== "optional_parameter" &&
      node.type !== "variable_declarator"
    )
      return;
    if (bindingName(node) !== receiverText) return;
    const scope = bindingScope(node, root);
    if (callOffset < scope.startIndex || callOffset > scope.endIndex) return;
    matches.push({
      node,
      scope,
      kind:
        node.type === "required_parameter" || node.type === "optional_parameter"
          ? "parameter"
          : "local",
    });
  });
  matches.sort((left, right) => {
    const scopeWidth =
      left.scope.endIndex -
      left.scope.startIndex -
      (right.scope.endIndex - right.scope.startIndex);
    return scopeWidth || right.node.startIndex - left.node.startIndex;
  });
  const binding = matches[0];
  return binding
    ? {
        kind: binding.kind,
        name: receiverText,
        declarationSpan: span(binding.node),
        scopeSpan: span(binding.scope),
      }
    : null;
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

function callMatches(record: WorkerCallSite, call: Node): boolean {
  const callee = call.childForFieldName("function");
  if (!callee) return false;
  const position =
    callee.childForFieldName("property") ??
    callee.childForFieldName("name") ??
    callee;
  const calleeName = callee.childForFieldName("property")?.text ?? callee.text;
  return (
    position.startPosition.row === record.startLine &&
    position.startPosition.column === record.startColumn &&
    calleeName === record.calleeName
  );
}

function callExpressions(root: Node): Node[] {
  const result: Node[] = [];
  walk(root, (node) => {
    if (node.type === "call_expression") result.push(node);
  });
  return result;
}

function findCall(record: WorkerCallSite, calls: readonly Node[]): Node | null {
  if (!record.calleeName || record.calleeKind === "computed") return null;
  return calls.find((candidate) => callMatches(record, candidate)) ?? null;
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
): PendingFact {
  const argsNode = call.childForFieldName("arguments");
  const args = argsNode ? namedChildren(argsNode) : [];
  const hasSpreadArgument = args.some(
    (argument) => argument.type === "spread_element",
  );
  const scope = lexicalScope(call, root);
  const binding = resolveReceiverBinding(record.receiverText, call, root);
  const fact: Omit<AstCallSiteShapeFact, "peerMemberNames"> = {
    startLine: record.startLine,
    startColumn: record.startColumn,
    calleeName: record.calleeName ?? "",
    calleeKind: record.calleeKind ?? "bare",
    receiverText: record.receiverText ?? null,
    receiverBinding: binding,
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
): AstCallSiteShapeFacts {
  const expressions = callExpressions(root);
  const pending = calls.flatMap((record) => {
    if (!isSupportedCall(record)) return [];
    const call = findCall(record, expressions);
    return call ? [pendingForCall(record, call, root)] : [];
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
