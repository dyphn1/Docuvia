import type { Node } from "web-tree-sitter";
import {
  AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
  type AstDeclaredCallableArity,
  type AstDeclaredDeclaration,
  type AstDeclaredDeclarationKind,
  type AstDeclaredOwnerInventory,
  type AstDeclaredTypeFact,
  type AstDeclaredTypeFactKind,
  type AstDeclaredTypeFacts,
  type AstDeclaredTypeLanguage,
  type AstDeclaredTypeOwner,
  type AstDeclaredTypeOwnerKind,
  type AstDeclaredUnsupportedReason,
  type AstDeclaredVisibility,
  type AstUtf16Span,
} from "@workspace/contracts";

const TYPE_FACT_DECLARATIONS = new Map<string, AstDeclaredTypeFactKind>([
  ["public_field_definition", "field-annotation"],
  ["field_definition", "field-annotation"],
  ["property_signature", "field-annotation"],
  ["required_parameter", "parameter-annotation"],
  ["optional_parameter", "parameter-annotation"],
  ["variable_declarator", "variable-annotation"],
]);

const RETURN_ANNOTATION_NODES = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
  "method_signature",
  "abstract_method_signature",
]);

const TYPE_SIGNATURE_NODE_TYPES = new Set([
  "function_type",
  "constructor_type",
  "call_signature",
  "construct_signature",
  "index_signature",
]);

const OWNER_NODE_KINDS = new Map<string, AstDeclaredTypeOwnerKind>([
  ["program", "program"],
  ["class_declaration", "class"],
  ["abstract_class_declaration", "class"],
  ["interface_declaration", "interface"],
  ["object", "object"],
  ["function_declaration", "function"],
  ["function_expression", "function"],
  ["generator_function", "function"],
  ["generator_function_declaration", "function"],
  ["arrow_function", "function"],
  ["method_definition", "method"],
  ["method_signature", "method"],
  ["abstract_method_signature", "method"],
]);

const INVENTORY_OWNER_NODE_TYPES = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "object",
]);

const MEMBER_KIND_BY_NODE = new Map<string, AstDeclaredDeclarationKind>([
  ["method_definition", "method"],
  ["method_signature", "method"],
  ["abstract_method_signature", "method"],
  ["public_field_definition", "field"],
  ["field_definition", "field"],
  ["property_signature", "field"],
]);

const FREE_CALLABLE_NODE_TYPES = new Map<string, AstDeclaredDeclarationKind>([
  ["function_declaration", "function"],
  ["function_expression", "function-expression"],
  ["generator_function", "function-expression"],
  ["generator_function_declaration", "function"],
  ["arrow_function", "arrow"],
]);

const SKIPPED_OWNER_CHILDREN = new Set(["comment", "class_static_block"]);
const SIMPLE_NAME_NODE_TYPES = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "private_property_identifier",
]);

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

function children(node: Node): Node[] {
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

function directName(node: Node): string | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode || !SIMPLE_NAME_NODE_TYPES.has(nameNode.type)) return null;
  return nameNode.text;
}

function typeParameterNames(node: Node): readonly string[] {
  const parameters = node.childForFieldName("type_parameters");
  if (!parameters) return [];
  return namedChildren(parameters)
    .filter((parameter) => parameter.type === "type_parameter")
    .map((parameter) => parameter.childForFieldName("name")?.text)
    .filter((name): name is string => Boolean(name));
}

function ownerFromNode(node: Node): AstDeclaredTypeOwner {
  const kind = OWNER_NODE_KINDS.get(node.type) ?? "program";
  const name = kind === "program" ? null : directName(node);
  return {
    kind,
    name,
    span: span(node),
    genericTypeParameterNames: typeParameterNames(node),
  };
}

function nearestOwner(node: Node | null): AstDeclaredTypeOwner {
  let current = node;
  while (current) {
    if (OWNER_NODE_KINDS.has(current.type)) return ownerFromNode(current);
    current = current.parent;
  }
  return {
    kind: "program",
    name: null,
    span: { start: 0, end: 0 },
    genericTypeParameterNames: [],
  };
}

function nearestAncestor(
  node: Node | null,
  matches: (candidate: Node) => boolean,
): Node | null {
  let current = node;
  while (current) {
    if (matches(current)) return current;
    current = current.parent;
  }
  return null;
}

function isClassOwnerNode(node: Node): boolean {
  return (
    node.type === "class_declaration" ||
    node.type === "abstract_class_declaration"
  );
}

function isTypeOwnerNode(node: Node): boolean {
  return isClassOwnerNode(node) || node.type === "interface_declaration";
}

function isCallableNode(node: Node): boolean {
  return RETURN_ANNOTATION_NODES.has(node.type);
}

function isParameterInsideTypeSignature(node: Node): boolean {
  let current = node.parent;
  while (current) {
    if (isCallableNode(current)) return false;
    if (TYPE_SIGNATURE_NODE_TYPES.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}

function isInsideObjectType(node: Node): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === "object_type") return true;
    current = current.parent;
  }
  return false;
}

function callableName(node: Node): string | null {
  const ownName = directName(node);
  if (ownName) return ownName;
  if (node.type !== "arrow_function" && node.type !== "function_expression")
    return null;
  const parent = node.parent;
  if (!parent) return null;
  const binding =
    parent.type === "variable_declarator"
      ? parent.childForFieldName("name")
      : parent.type === "pair"
        ? parent.childForFieldName("key")
        : null;
  return binding && SIMPLE_NAME_NODE_TYPES.has(binding.type)
    ? binding.text
    : null;
}

function lexicalScope(node: Node): AstUtf16Span {
  let current: Node | null = node;
  while (current) {
    if (
      current.type === "program" ||
      current.type === "class_body" ||
      current.type === "interface_body" ||
      current.type === "statement_block" ||
      current.type === "object"
    )
      return span(current);
    if (isCallableNode(current)) {
      const body = current.childForFieldName("body");
      return span(body ?? current);
    }
    current = current.parent;
  }
  return span(node);
}

function varDeclarationScope(node: Node): AstUtf16Span | null {
  if (node.type !== "variable_declarator") return null;
  const declaration = node.parent;
  if (declaration?.type !== "variable_declaration") return null;
  let current = declaration.parent;
  while (current) {
    if (isCallableNode(current)) {
      const body = current.childForFieldName("body");
      return span(body ?? current);
    }
    if (current.type === "program") return span(current);
    current = current.parent;
  }
  return null;
}

function hasModifier(node: Node, modifier: string): boolean {
  return children(node).some((child) => child.text === modifier);
}

function nearestConstructor(node: Node): Node | null {
  let current = node.parent;
  while (current) {
    if (
      current.type === "method_definition" &&
      directName(current) === "constructor"
    )
      return current;
    if (current.type === "class_body" || current.type === "program")
      return null;
    current = current.parent;
  }
  return null;
}

function isParameterProperty(
  node: Node,
  language: AstDeclaredTypeLanguage,
): boolean {
  if (language === "javascript" || !nearestConstructor(node)) return false;
  return children(node).some(
    (child) =>
      child.type === "accessibility_modifier" || child.text === "readonly",
  );
}

function isShadowedTypeParameter(typeNode: Node, name: string): boolean {
  let current = typeNode.parent;
  while (current) {
    if (typeParameterNames(current).includes(name)) return true;
    current = current.parent;
  }
  return false;
}

function simpleTypeReference(node: Node | null): Node | null {
  if (!node || !SIMPLE_NAME_NODE_TYPES.has(node.type)) return null;
  return node;
}

function annotationTypeNode(annotation: Node | null): Node | null {
  if (!annotation || annotation.type !== "type_annotation") return null;
  const types = namedChildren(annotation).filter(
    (child) => child.type !== "comment",
  );
  return types.length === 1 ? simpleTypeReference(types[0]) : null;
}

function declarationBindingName(node: Node): string | null {
  if (
    node.type === "required_parameter" ||
    node.type === "optional_parameter"
  ) {
    const pattern = node.childForFieldName("pattern");
    return pattern && SIMPLE_NAME_NODE_TYPES.has(pattern.type)
      ? pattern.text
      : null;
  }
  const name =
    node.childForFieldName("name") ?? node.childForFieldName("property");
  return name && SIMPLE_NAME_NODE_TYPES.has(name.type) ? name.text : null;
}

function factOwner(
  node: Node,
  kind: AstDeclaredTypeFactKind,
): AstDeclaredTypeOwner {
  if (kind === "return-annotation") return ownerFromNode(node);
  const ownerNode =
    kind === "parameter-property"
      ? nearestAncestor(node.parent, isClassOwnerNode)
      : kind === "parameter-annotation"
        ? nearestAncestor(node.parent, isCallableNode)
        : kind === "field-annotation" ||
            kind === "implements" ||
            kind === "extends"
          ? nearestAncestor(node.parent, isTypeOwnerNode)
          : null;
  if (ownerNode) return ownerFromNode(ownerNode);
  return nearestOwner(node.parent);
}

function factLexicalScope(
  node: Node,
  kind: AstDeclaredTypeFactKind,
): AstUtf16Span {
  if (kind === "variable-annotation" || kind === "new-initializer") {
    const varScope = varDeclarationScope(node);
    if (varScope) return varScope;
  }
  if (
    kind === "parameter-property" ||
    kind === "implements" ||
    kind === "extends"
  ) {
    const classNode = nearestAncestor(node.parent, isClassOwnerNode);
    if (classNode)
      return span(classNode.childForFieldName("body") ?? classNode);
  }
  return lexicalScope(node);
}

function makeFact(
  kind: AstDeclaredTypeFactKind,
  name: string | null,
  typeNode: Node | null,
  declaration: Node,
  ownerNode: Node,
): AstDeclaredTypeFact | null {
  const simpleType = simpleTypeReference(typeNode);
  if (!simpleType || isShadowedTypeParameter(simpleType, simpleType.text))
    return null;
  const owner = factOwner(ownerNode, kind);
  return {
    kind,
    name,
    typeName: simpleType.text,
    typeText: simpleType.text,
    declarationSpan: span(declaration),
    typeSpan: span(simpleType),
    owner,
    lexicalScopeSpan: factLexicalScope(declaration, kind),
  };
}

function typeFactForDeclaration(
  node: Node,
  language: AstDeclaredTypeLanguage,
): AstDeclaredTypeFact | null {
  const kind = TYPE_FACT_DECLARATIONS.get(node.type);
  if (!kind || language === "javascript") return null;
  if (isRejectedTypeDeclaration(node, kind)) return null;
  const annotation = node.childForFieldName("type");
  if (node.hasError || annotation?.hasError) return null;
  const typeNode = annotationTypeNode(annotation);
  const factKind =
    kind === "parameter-annotation" && isParameterProperty(node, language)
      ? "parameter-property"
      : kind;
  return makeFact(factKind, declarationBindingName(node), typeNode, node, node);
}

function isRejectedTypeDeclaration(
  node: Node,
  kind: AstDeclaredTypeFactKind,
): boolean {
  return (
    isInsideObjectType(node) ||
    (kind === "parameter-annotation" && isParameterInsideTypeSignature(node))
  );
}

function typeFactForReturn(node: Node): AstDeclaredTypeFact | null {
  if (isInsideObjectType(node)) return null;
  const annotation = node.childForFieldName("return_type");
  if (node.hasError || annotation?.hasError) return null;
  const typeNode = annotationTypeNode(annotation);
  return makeFact(
    "return-annotation",
    callableName(node),
    typeNode,
    node,
    node,
  );
}

function typeFactForInitializer(node: Node): AstDeclaredTypeFact | null {
  if (
    node.type !== "variable_declarator" &&
    node.type !== "public_field_definition" &&
    node.type !== "field_definition"
  )
    return null;
  const value = node.childForFieldName("value");
  if (
    node.hasError ||
    value?.type !== "new_expression" ||
    value.hasError ||
    value.childForFieldName("type_arguments")
  )
    return null;
  const constructor = simpleTypeReference(
    value.childForFieldName("constructor"),
  );
  if (!constructor) return null;
  return makeFact(
    "new-initializer",
    declarationBindingName(node),
    constructor,
    node,
    node,
  );
}

function typeFactsForHeritage(
  node: Node,
  language: AstDeclaredTypeLanguage,
): AstDeclaredTypeFact[] {
  if (node.hasError) return [];
  if (language === "javascript" && node.type === "class_heritage")
    return javascriptHeritageFact(node);
  const kind = heritageFactKind(node);
  if (!kind || !isSupportedHeritageNode(node)) return [];
  const targets = heritageTargets(node);
  const owner = nearestOwner(node.parent);
  return targets
    .map((target) => makeFact(kind, owner.name, target, node, node))
    .filter((fact): fact is AstDeclaredTypeFact => fact !== null);
}

function javascriptHeritageFact(node: Node): AstDeclaredTypeFact[] {
  const target = simpleTypeReference(namedChildren(node)[0] ?? null);
  const owner = nearestOwner(node.parent);
  const fact = makeFact("extends", owner.name, target, node, node);
  return fact ? [fact] : [];
}

function heritageFactKind(node: Node): "implements" | "extends" | null {
  if (node.type === "implements_clause") return "implements";
  if (node.type === "extends_clause" || node.type === "extends_type_clause")
    return "extends";
  return null;
}

function heritageDeclaration(node: Node): Node | null {
  const declaration = nearestAncestor(node.parent, isTypeOwnerNode);
  const obstructingType = nearestAncestor(
    node.parent,
    (candidate) =>
      candidate.type === "conditional_type" ||
      candidate.type === "type_alias_declaration",
  );
  if (
    obstructingType &&
    (!declaration || obstructingType.startIndex > declaration.startIndex)
  )
    return null;
  return declaration;
}

function isSupportedHeritageNode(node: Node): boolean {
  const declaration = heritageDeclaration(node);
  if (!declaration || node.childForFieldName("type_arguments")) return false;
  if (node.type === "extends_type_clause")
    return declaration.type === "interface_declaration";
  return isClassOwnerNode(declaration);
}

function heritageTargets(node: Node): Node[] {
  if (node.type !== "extends_clause") return namedChildren(node);
  const value = node.childForFieldName("value");
  return value ? [value] : [];
}

function hasSyntaxError(node: Node): boolean {
  return node.type === "ERROR" || node.isMissing || node.hasError;
}

function visibilityOf(
  node: Node,
  memberName: string | null,
): AstDeclaredVisibility {
  if (memberName?.startsWith("#")) return "private";
  const modifier = namedChildren(node).find(
    (child) => child.type === "accessibility_modifier",
  );
  if (modifier?.text === "private" || modifier?.text === "protected")
    return modifier.text;
  return "public";
}

function hasOptionalMarker(node: Node): boolean {
  return children(node).some((child) => child.text === "?");
}

function parameterNodes(callable: Node): Node[] {
  const parameters = callable.childForFieldName("parameters");
  if (parameters)
    return namedChildren(parameters).filter(
      (parameter) => parameter.type !== "comment",
    );
  const parameter = callable.childForFieldName("parameter");
  return parameter ? [parameter] : [];
}

function parameterPattern(parameter: Node): Node | null {
  return parameter.childForFieldName("pattern") ?? parameter;
}

function isRestParameter(parameter: Node): boolean {
  return (
    parameter.type === "rest_pattern" ||
    parameterPattern(parameter)?.type === "rest_pattern"
  );
}

function isOptionalParameter(parameter: Node): boolean {
  if (
    parameter.type === "optional_parameter" ||
    parameter.type === "rest_pattern" ||
    parameter.type === "assignment_pattern"
  )
    return true;
  if (parameter.childForFieldName("value")) return true;
  return children(parameter).some((child) => child.text === "?");
}

function isThisParameter(parameter: Node): boolean {
  return parameterPattern(parameter)?.text === "this";
}

function callableArity(callable: Node): AstDeclaredCallableArity {
  const params = parameterNodes(callable).filter(
    (parameter) => !isThisParameter(parameter),
  );
  let requiredParameterCount = 0;
  let hasRest = false;
  params.forEach((parameter, index) => {
    if (isRestParameter(parameter)) hasRest = true;
    else if (!isOptionalParameter(parameter))
      requiredParameterCount = index + 1;
  });
  return {
    requiredParameterCount,
    maxParameterCount: hasRest ? null : params.length,
  };
}

function staticMemberName(node: Node): string | null {
  const name =
    node.childForFieldName("name") ?? node.childForFieldName("property");
  if (name && SIMPLE_NAME_NODE_TYPES.has(name.type)) return name.text;
  return null;
}

function unknownMemberDeclaration(
  node: Node,
  owner: AstDeclaredTypeOwner,
  reason: AstDeclaredUnsupportedReason,
  name: string | null,
): AstDeclaredDeclaration {
  return {
    kind: "unknown",
    name,
    declarationSpan: span(node),
    owner,
    lexicalScopeSpan: span(node),
    visibility: null,
    isStatic: false,
    isAbstract: false,
    isOptional: false,
    arity: null,
    genericTypeParameterNames: [],
    unsupportedReason: reason,
  };
}

function declaredMemberKind(
  kind: AstDeclaredDeclarationKind,
  node: Node,
  name: string,
): AstDeclaredDeclarationKind {
  if (kind !== "method") return kind;
  if (name === "constructor") return "constructor";
  if (hasModifier(node, "get")) return "getter";
  if (hasModifier(node, "set")) return "setter";
  return kind;
}

function memberCallableArity(
  node: Node,
  kind: AstDeclaredDeclarationKind,
): AstDeclaredCallableArity | null {
  const callable =
    kind === "method" ||
    kind === "constructor" ||
    kind === "getter" ||
    kind === "setter";
  if (callable) return callableArity(node);
  const value = node.childForFieldName("value");
  return value && RETURN_ANNOTATION_NODES.has(value.type)
    ? callableArity(value)
    : null;
}

function memberDeclaration(
  node: Node,
  owner: AstDeclaredTypeOwner,
): AstDeclaredDeclaration {
  const kind = MEMBER_KIND_BY_NODE.get(node.type);
  const name = staticMemberName(node);
  if (hasSyntaxError(node))
    return unknownMemberDeclaration(node, owner, "syntax-error", name);
  if (!kind || !name) {
    const reason: AstDeclaredUnsupportedReason = name
      ? "unsupported-member"
      : "computed-name";
    return unknownMemberDeclaration(node, owner, reason, name);
  }
  const declaredKind = declaredMemberKind(kind, node, name);
  return {
    kind: declaredKind,
    name,
    declarationSpan: span(node),
    owner,
    lexicalScopeSpan: lexicalScope(node),
    visibility: visibilityOf(node, name),
    isStatic: hasModifier(node, "static"),
    isAbstract:
      node.type === "abstract_method_signature" ||
      hasModifier(node, "abstract"),
    isOptional: hasOptionalMarker(node),
    arity: memberCallableArity(node, declaredKind),
    genericTypeParameterNames: typeParameterNames(node),
  };
}

function pairDeclaration(
  node: Node,
  owner: AstDeclaredTypeOwner,
): AstDeclaredDeclaration {
  const key = node.childForFieldName("key");
  const value = node.childForFieldName("value");
  const name = key && SIMPLE_NAME_NODE_TYPES.has(key.type) ? key.text : null;
  if (!name || !value || hasSyntaxError(node)) {
    const reason: AstDeclaredUnsupportedReason = hasSyntaxError(node)
      ? "syntax-error"
      : "computed-name";
    return {
      kind: "unknown",
      name,
      declarationSpan: span(node),
      owner,
      lexicalScopeSpan: span(node),
      visibility: null,
      isStatic: false,
      isAbstract: false,
      isOptional: false,
      arity: null,
      genericTypeParameterNames: [],
      unsupportedReason: reason,
    };
  }
  return {
    kind: "field",
    name,
    declarationSpan: span(node),
    owner,
    lexicalScopeSpan: span(ownerNodeFromSpan(node, owner)),
    visibility: "public",
    isStatic: false,
    isAbstract: false,
    isOptional: hasOptionalMarker(node),
    arity: isCallableNode(value) ? callableArity(value) : null,
    genericTypeParameterNames: [],
  };
}

function ownerNodeFromSpan(node: Node, owner: AstDeclaredTypeOwner): Node {
  let current: Node | null = node.parent;
  while (current) {
    const candidate = OWNER_NODE_KINDS.get(current.type);
    if (
      candidate === owner.kind &&
      current.startIndex === owner.span.start &&
      current.endIndex === owner.span.end
    )
      return current;
    current = current.parent;
  }
  return node;
}

function ownerBody(node: Node): Node | null {
  if (node.type === "object") return node;
  return node.childForFieldName("body");
}

function unknownParameterProperty(
  parameter: Node,
  owner: AstDeclaredTypeOwner,
  body: Node,
): AstDeclaredDeclaration {
  return {
    kind: "unknown",
    name: null,
    declarationSpan: span(parameter),
    owner,
    lexicalScopeSpan: span(body),
    visibility: null,
    isStatic: false,
    isAbstract: false,
    isOptional: false,
    arity: null,
    genericTypeParameterNames: [],
    unsupportedReason: "computed-name",
  };
}

function constructorPropertyDeclaration(
  parameter: Node,
  owner: AstDeclaredTypeOwner,
  body: Node,
): AstDeclaredDeclaration {
  const name = declarationBindingName(parameter);
  if (!name) return unknownParameterProperty(parameter, owner, body);
  return {
    kind: "field",
    name,
    declarationSpan: span(parameter),
    owner,
    lexicalScopeSpan: span(body),
    visibility: visibilityOf(parameter, name),
    isStatic: false,
    isAbstract: false,
    isOptional: hasOptionalMarker(parameter),
    arity: null,
    genericTypeParameterNames: [],
  };
}

function constructorPropertyDeclarations(
  method: Node,
  owner: AstDeclaredTypeOwner,
  body: Node,
): AstDeclaredDeclaration[] {
  const parameters = method.childForFieldName("parameters");
  return (parameters ? namedChildren(parameters) : [])
    .filter((parameter) => isParameterProperty(parameter, "typescript"))
    .map((parameter) => constructorPropertyDeclaration(parameter, owner, body));
}

function childDeclarations(
  child: Node,
  ownerNodeType: string,
  owner: AstDeclaredTypeOwner,
  body: Node,
): AstDeclaredDeclaration[] {
  if (child.type === "pair" && ownerNodeType === "object")
    return [pairDeclaration(child, owner)];
  const declaration = memberDeclaration(child, owner);
  const properties =
    declaration.kind === "constructor"
      ? constructorPropertyDeclarations(child, owner, body)
      : [];
  return [declaration, ...properties];
}

function collectOwnerDeclarations(
  body: Node,
  ownerNodeType: string,
  owner: AstDeclaredTypeOwner,
): {
  declarations: AstDeclaredDeclaration[];
  reasons: Set<AstDeclaredUnsupportedReason>;
} {
  const declarations: AstDeclaredDeclaration[] = [];
  const reasons = new Set<AstDeclaredUnsupportedReason>();
  if (body.hasError) reasons.add("syntax-error");
  for (const child of namedChildren(body)) {
    if (SKIPPED_OWNER_CHILDREN.has(child.type)) continue;
    const childItems = childDeclarations(child, ownerNodeType, owner, body);
    declarations.push(...childItems);
    for (const item of childItems) {
      if (item.unsupportedReason) reasons.add(item.unsupportedReason);
    }
  }
  return { declarations, reasons };
}

function collectOwnerInventory(node: Node): {
  inventory: AstDeclaredOwnerInventory;
  declarations: AstDeclaredDeclaration[];
} {
  const owner = ownerFromNode(node);
  const body = ownerBody(node);
  const collected = body
    ? collectOwnerDeclarations(body, node.type, owner)
    : {
        declarations: [],
        reasons: new Set<AstDeclaredUnsupportedReason>(["unsupported-member"]),
      };
  return {
    inventory: {
      owner,
      complete: collected.reasons.size === 0,
      incompleteReasons: [...collected.reasons].sort(),
    },
    declarations: collected.declarations,
  };
}

function freeCallableDeclaration(node: Node): AstDeclaredDeclaration {
  const kind = FREE_CALLABLE_NODE_TYPES.get(node.type) ?? "function";
  return {
    kind,
    name: callableName(node),
    declarationSpan: span(node),
    owner: nearestOwner(node.parent),
    lexicalScopeSpan: lexicalScope(node),
    visibility: null,
    isStatic: false,
    isAbstract: false,
    isOptional: false,
    arity: callableArity(node),
    genericTypeParameterNames: typeParameterNames(node),
  };
}

function isFunctionValueMember(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  const valueMatchesNode = (value: Node | null) =>
    value?.type === node.type &&
    value.startIndex === node.startIndex &&
    value.endIndex === node.endIndex;
  if (
    (parent.type === "public_field_definition" ||
      parent.type === "field_definition") &&
    valueMatchesNode(parent.childForFieldName("value"))
  )
    return true;
  if (
    parent.type === "pair" &&
    valueMatchesNode(parent.childForFieldName("value"))
  )
    return true;
  return false;
}

function isAnonymousDirectDefaultFunction(node: Node): boolean {
  return (
    node.type === "function_expression" &&
    node.parent?.type === "export_statement" &&
    /^export\s+default\s+(?:async\s+)?function(?:\s|\*|\()/u.test(
      node.parent.text,
    )
  );
}

function compareFacts(a: AstDeclaredTypeFact, b: AstDeclaredTypeFact): number {
  return (
    a.declarationSpan.start - b.declarationSpan.start ||
    a.typeSpan.start - b.typeSpan.start ||
    a.kind.localeCompare(b.kind)
  );
}

function compareDeclarations(
  a: AstDeclaredDeclaration,
  b: AstDeclaredDeclaration,
): number {
  return (
    a.declarationSpan.start - b.declarationSpan.start ||
    a.declarationSpan.end - b.declarationSpan.end ||
    a.kind.localeCompare(b.kind)
  );
}

/**
 * Extract explicit TS/JS type syntax and a separate declaration/member inventory. The result
 * contains no graph IDs, parser allocation IDs, source hashes, or inferred type relationships.
 */
export function extractDeclaredTypeFacts(
  root: Node,
  language: AstDeclaredTypeLanguage,
): AstDeclaredTypeFacts {
  if (
    language !== "typescript" &&
    language !== "tsx" &&
    language !== "javascript"
  )
    throw new RangeError(
      `Unsupported declared-type grammar: ${String(language)}`,
    );

  const facts: AstDeclaredTypeFact[] = [];
  const declarations: AstDeclaredDeclaration[] = [];
  const ownerInventories: AstDeclaredOwnerInventory[] = [];
  const visitedOwners = new Set<string>();

  walk(root, (node) => {
    const annotationFact = typeFactForDeclaration(node, language);
    if (annotationFact) facts.push(annotationFact);
    const returnFact = typeFactForReturn(node);
    if (returnFact) facts.push(returnFact);
    const initializerFact = typeFactForInitializer(node);
    if (initializerFact) facts.push(initializerFact);
    facts.push(...typeFactsForHeritage(node, language));

    if (INVENTORY_OWNER_NODE_TYPES.has(node.type)) {
      const key = `${node.startIndex}:${node.endIndex}:${node.type}`;
      if (!visitedOwners.has(key)) {
        visitedOwners.add(key);
        const collected = collectOwnerInventory(node);
        ownerInventories.push(collected.inventory);
        declarations.push(...collected.declarations);
      }
    }

    if (
      FREE_CALLABLE_NODE_TYPES.has(node.type) &&
      (!isFunctionValueMember(node) || isAnonymousDirectDefaultFunction(node))
    )
      declarations.push(freeCallableDeclaration(node));
  });

  facts.sort(compareFacts);
  declarations.sort(compareDeclarations);
  ownerInventories.sort(
    (a, b) =>
      a.owner.span.start - b.owner.span.start ||
      a.owner.kind.localeCompare(b.owner.kind),
  );

  return {
    schemaVersion: AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
    language,
    facts,
    declarations,
    ownerInventories,
  };
}
