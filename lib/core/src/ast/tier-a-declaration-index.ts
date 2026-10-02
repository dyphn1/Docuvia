import { createHash } from "node:crypto";
import type { LanguageProvider } from "@workspace/ast-core";
import { LanguageNodeTypes } from "@workspace/ast-core";
import { ENCODING_HEX, HASH_ALGO_SHA256 } from "@workspace/contracts";
import type { Node, Tree } from "web-tree-sitter";
import {
  buildQualifiedBaseKey,
  buildUniqueNodeKey,
} from "../graph/node-key.js";
import { AstMessages, AstNodeTypes } from "./ast-constants.js";

export interface TierAFunctionSummary {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly contentHash?: string;
  readonly containerName?: string;
}

export interface TierAClassSummary {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly methods: string[];
  readonly contentHash?: string;
}

export interface TierAVariableSummary {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly contentHash?: string;
}

export interface TierAIndexedDeclaration {
  readonly nodeKey: string;
  readonly name: string;
  readonly containerName?: string;
  readonly nodeType: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly nameStartIndex: number | null;
  readonly sourceText: string;
  readonly signatureText: string;
}

interface CallableName {
  readonly name: string;
  readonly nameNode: Node | null | undefined;
}

const NAME_BEARING_PARENT_TYPES = new Set<string>([
  AstNodeTypes.VARIABLE_DECLARATOR,
  AstNodeTypes.ASSIGNMENT_EXPRESSION,
  AstNodeTypes.PAIR,
  AstNodeTypes.PUBLIC_FIELD_DEFINITION,
]);

const CALLABLE_SCOPE_NODE_TYPES = new Set<string>([
  LanguageNodeTypes.ARROW_FUNCTION,
  LanguageNodeTypes.FUNCTION_EXPRESSION,
  LanguageNodeTypes.FUNCTION_DECLARATION,
  LanguageNodeTypes.GENERATOR_FUNCTION,
  LanguageNodeTypes.GENERATOR_FUNCTION_DECLARATION,
  LanguageNodeTypes.FUNCTION_DEFINITION,
  LanguageNodeTypes.METHOD_DECLARATION,
  LanguageNodeTypes.METHOD_DEFINITION,
  LanguageNodeTypes.LOCAL_FUNCTION_STATEMENT,
  LanguageNodeTypes.CONSTRUCTOR_DECLARATION,
  LanguageNodeTypes.DESTRUCTOR_DECLARATION,
  LanguageNodeTypes.CONVERSION_OPERATOR_DECLARATION,
  LanguageNodeTypes.OPERATOR_DECLARATION,
  LanguageNodeTypes.COMPACT_CONSTRUCTOR_DECLARATION,
  LanguageNodeTypes.METHOD,
  LanguageNodeTypes.SINGLETON_METHOD,
  LanguageNodeTypes.FUNCTION_ITEM,
]);

/**
 * Symbol-level feature hash (STOR-005): a hash of the AST node's own exact source span
 * (`node.text`), independent of the containing file's blob hash. Lets a single-symbol edit
 * produce a one-line JSONL diff for that symbol without touching its untouched siblings' hashes.
 *
 * The algorithm/digest constants come from `@workspace/contracts` (issue #211) so the worker's
 * hashes can never drift from the main thread's (`ast-worker-pool.ts`, `file-discovery.service.ts`)
 * or `lib/schema`'s. Package-name imports resolve through node_modules and work fine inside a
 * `worker_threads` Worker (as the existing contracts/ast-core imports above prove) — only bare
 * relative `.js`-to-`.ts` sibling imports needed a tsx resolve hook that doesn't propagate into
 * workers, and even that limitation is moot in dist/ where a fully-compiled worker ships.
 */
function symbolContentHash(node: Node): string {
  return createHash(HASH_ALGO_SHA256).update(node.text).digest(ENCODING_HEX);
}

function getNodeName(node: Node): string {
  return (
    node.childForFieldName("name")?.text ||
    node.descendantsOfType(LanguageNodeTypes.IDENTIFIER)[0]?.text ||
    AstMessages.ANONYMOUS_NAME
  );
}

function resolveDeclaratorNestedName(node: Node): Node | null | undefined {
  return node.childForFieldName("declarator")?.childForFieldName("declarator");
}

function callableNameFromDeclaration(node: Node): CallableName | undefined {
  const ownName = node.childForFieldName("name");
  if (ownName) return { name: ownName.text, nameNode: ownName };

  const declaratorName = resolveDeclaratorNestedName(node);
  if (!declaratorName) return undefined;
  if (declaratorName.type !== AstNodeTypes.QUALIFIED_IDENTIFIER)
    return { name: declaratorName.text, nameNode: declaratorName };
  const qualifiedName = declaratorName.childForFieldName("name");
  return {
    name: qualifiedName?.text ?? AstMessages.ANONYMOUS_NAME,
    nameNode: qualifiedName,
  };
}

function callableNameFromParent(node: Node): CallableName | undefined {
  let current = node.parent;
  while (current) {
    // An `arguments` ancestor means this callable is itself passed as a call argument
    // (for example, `arr.map(x => x + 1)`). Stop here: climbing further would misattribute
    // the outer binding, such as `results` in `const results = arr.map(...)`, to this callback.
    if (current.type === AstNodeTypes.ARGUMENTS) return undefined;
    // A callable nested in another function belongs to its own scope. Do not climb through that
    // boundary to inherit an outer binding, as with `const factory = () => { return () => {}; }`.
    if (CALLABLE_SCOPE_NODE_TYPES.has(current.type)) return undefined;
    if (NAME_BEARING_PARENT_TYPES.has(current.type)) {
      const nameNode =
        current.childForFieldName("name") ||
        current.childForFieldName("key") ||
        current.childForFieldName("left");
      if (nameNode) return { name: nameNode.text, nameNode };
    }
    current = current.parent;
  }
  return undefined;
}

function callableName(node: Node): CallableName {
  return (
    callableNameFromDeclaration(node) ??
    callableNameFromParent(node) ?? {
      name: AstMessages.ANONYMOUS_NAME,
      nameNode: undefined,
    }
  );
}

export function resolveCallableName(node: Node): string {
  return callableName(node).name;
}

/** Walk to the nearest extracted function/class container, or return the anonymous sentinel. */
export function findEnclosingContainerName(
  node: Node,
  containerIds: ReadonlySet<number>,
): string {
  let current = node.parent;
  while (current) {
    if (containerIds.has(current.id)) return getNodeName(current);
    current = current.parent;
  }
  return AstMessages.ANONYMOUS_NAME;
}

/** Unwrap Rust generic impl and Go pointer receiver fields to their contained type identifier. */
function firstTypeIdentifierText(node: Node): string | undefined {
  return node.type === AstNodeTypes.TYPE_IDENTIFIER
    ? node.text
    : node.descendantsOfType(AstNodeTypes.TYPE_IDENTIFIER)[0]?.text;
}

/**
 * GRPH-006 (Rust): `impl_item` is not part of the extracted class nodes, so the lexical ancestor
 * walk returns `anonymous`. The concrete Self type is on the impl's `type` field; for `impl Trait
 * for Type`, use `Type`, not the trait name.
 */
function resolveRustImplContainerName(node: Node): string | undefined {
  let current = node.parent;
  while (current) {
    if (current.type === AstNodeTypes.IMPL_ITEM) {
      const typeField = current.childForFieldName("type");
      return typeField ? firstTypeIdentifierText(typeField) : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * GRPH-006 (Go): a method's receiver type is in its own `receiver` field, not an ancestor; a
 * `type_declaration` does not enclose a `method_declaration`.
 */
function resolveGoReceiverContainerName(node: Node): string | undefined {
  const receiver = node.childForFieldName("receiver");
  const paramType = receiver?.namedChild(0)?.childForFieldName("type");
  return paramType ? firstTypeIdentifierText(paramType) : undefined;
}

/**
 * GRPH-006 (C++): out-of-line `Ret Class::method(){}` is not lexically inside the class. Its
 * declarator's `qualified_identifier.scope` supplies the immediate container; nested qualifiers
 * use the innermost scope, matching the index's single-level containment rule.
 */
function resolveCppQualifiedContainerName(node: Node): string | undefined {
  const declarator = node.childForFieldName("declarator");
  const inner = declarator?.childForFieldName("declarator");
  if (inner?.type !== AstNodeTypes.QUALIFIED_IDENTIFIER) return undefined;
  const scope = inner.childForFieldName("scope");
  if (!scope) return undefined;
  return scope.type === AstNodeTypes.QUALIFIED_IDENTIFIER
    ? scope.childForFieldName("name")?.text
    : scope.text;
}

/** Apply the Rust, Go, and C++ non-lexical container rules after the generic ancestor walk misses. */
function resolveDeferredLanguageContainerName(node: Node): string | undefined {
  return (
    resolveRustImplContainerName(node) ??
    resolveGoReceiverContainerName(node) ??
    resolveCppQualifiedContainerName(node)
  );
}

export function collectClassNodes(
  tree: Tree,
  provider: LanguageProvider,
  classes: TierAClassSummary[],
): Node[] {
  const classNodes = provider.extractClasses(tree.rootNode);
  for (const node of classNodes) {
    classes.push({
      name: getNodeName(node),
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      methods: [],
      contentHash: symbolContentHash(node),
    });
  }
  return classNodes;
}

const FUNCTION_VALUE_NODE_TYPES = new Set<string>([
  LanguageNodeTypes.ARROW_FUNCTION,
  LanguageNodeTypes.FUNCTION_EXPRESSION,
]);

export function collectVariableNodes(
  tree: Tree,
  provider: LanguageProvider,
  variables: TierAVariableSummary[],
): Node[] {
  const variableNodes = provider.extractVariables?.(tree.rootNode) ?? [];
  const indexableNodes: Node[] = [];
  for (const node of variableNodes) {
    const value = node.childForFieldName("value");
    if (value && FUNCTION_VALUE_NODE_TYPES.has(value.type)) continue;
    indexableNodes.push(node);
    variables.push({
      name: getNodeName(node),
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      contentHash: symbolContentHash(node),
    });
  }
  return indexableNodes;
}

export function collectFunctionNodes(
  tree: Tree,
  provider: LanguageProvider,
  functions: TierAFunctionSummary[],
  classNodes: Node[],
): Node[] {
  const classIds = new Set(classNodes.map((node) => node.id));
  const functionNodes = provider.extractFunctions(tree.rootNode);
  for (const node of functionNodes) {
    const container = findEnclosingContainerName(node, classIds);
    // The anonymous sentinel means top-level here. Persisting it as a real container would
    // incorrectly qualify every top-level function as `file#anonymous.name`.
    const containerName =
      container === AstMessages.ANONYMOUS_NAME
        ? resolveDeferredLanguageContainerName(node)
        : container;
    functions.push({
      name: callableName(node).name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      contentHash: symbolContentHash(node),
      containerName,
    });
  }
  return functionNodes;
}

export function extractTierAIndexedDeclarations(
  filePath: string,
  tree: Tree,
  provider: LanguageProvider,
): TierAIndexedDeclaration[] {
  const classes: TierAClassSummary[] = [];
  const functions: TierAFunctionSummary[] = [];
  const variables: TierAVariableSummary[] = [];
  const classNodes = collectClassNodes(tree, provider, classes);
  const functionNodes = collectFunctionNodes(
    tree,
    provider,
    functions,
    classNodes,
  );
  const variableNodes = collectVariableNodes(tree, provider, variables);
  const usedNodeKeys = new Set<string>([filePath]);
  const declarations: TierAIndexedDeclaration[] = [];

  for (let index = 0; index < functionNodes.length; index += 1) {
    const node = functionNodes[index];
    const summary = functions[index];
    if (!node || !summary) continue;
    const nodeKey = buildUniqueNodeKey(
      usedNodeKeys,
      buildQualifiedBaseKey(filePath, summary.name, summary.containerName),
      summary.startLine,
    );
    usedNodeKeys.add(nodeKey);
    declarations.push(
      indexedDeclaration(nodeKey, summary.name, summary.containerName, node),
    );
  }

  for (let index = 0; index < classNodes.length; index += 1) {
    const node = classNodes[index];
    const summary = classes[index];
    if (!node || !summary) continue;
    const nodeKey = buildUniqueNodeKey(
      usedNodeKeys,
      buildQualifiedBaseKey(filePath, summary.name),
      summary.startLine,
    );
    usedNodeKeys.add(nodeKey);
    declarations.push(
      indexedDeclaration(nodeKey, summary.name, undefined, node),
    );
  }

  for (let index = 0; index < variableNodes.length; index += 1) {
    const node = variableNodes[index];
    const summary = variables[index];
    if (!node || !summary) continue;
    const nodeKey = buildUniqueNodeKey(
      usedNodeKeys,
      buildQualifiedBaseKey(filePath, summary.name),
      summary.startLine,
    );
    usedNodeKeys.add(nodeKey);
    declarations.push(
      indexedDeclaration(nodeKey, summary.name, undefined, node),
    );
  }

  return declarations;
}

function indexedDeclaration(
  nodeKey: string,
  name: string,
  containerName: string | undefined,
  node: Node,
): TierAIndexedDeclaration {
  const nameNode =
    node.childForFieldName("name") ?? callableName(node).nameNode;
  return {
    nodeKey,
    name,
    containerName,
    nodeType: node.type,
    startLine: node.startPosition.row,
    endLine: node.endPosition.row,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    nameStartIndex: nameNode?.startIndex ?? null,
    sourceText: node.text,
    signatureText: signatureText(node),
  };
}

function signatureText(node: Node): string {
  const body = node.childForFieldName("body");
  if (!body) return node.text.trim();
  return node.text.slice(0, body.startIndex - node.startIndex).trim();
}
