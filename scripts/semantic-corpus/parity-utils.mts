import type { ParsedAstFileResult } from "../../lib/contracts/src/index.js";
import {
  exactCallerNodeForCall,
  createFunctionNodeReference,
} from "../../lib/core/src/graph/call-resolution-graph-projection.js";
import {
  buildQualifiedBaseKey,
  buildUniqueNodeKey,
} from "../../lib/core/src/graph/node-key.js";

type ParsedCall = NonNullable<ParsedAstFileResult["data"]["calls"]>[number];

/** Mirrors the graph persister's function/class/variable node-key allocation for parity rows. */
export function exactCallerNodeKeyForCall(
  result: ParsedAstFileResult,
  call: ParsedCall,
): string {
  const usedNodeKeys = new Set([result.file]);
  const functionNodes = (result.data.functions ?? []).map((fn) => {
    const nodeKey = buildUniqueNodeKey(
      usedNodeKeys,
      buildQualifiedBaseKey(result.file, fn.name, fn.containerName),
      fn.startLine,
    );
    usedNodeKeys.add(nodeKey);
    return createFunctionNodeReference(result, fn, nodeKey);
  });
  for (const cls of result.data.classes ?? []) {
    const nodeKey = buildUniqueNodeKey(
      usedNodeKeys,
      `${result.file}#${cls.name}`,
      cls.startLine,
    );
    usedNodeKeys.add(nodeKey);
  }
  for (const variable of result.data.variables ?? []) {
    const nodeKey = buildUniqueNodeKey(
      usedNodeKeys,
      `${result.file}#${variable.name}`,
      variable.startLine,
    );
    usedNodeKeys.add(nodeKey);
  }
  return exactCallerNodeForCall(result, call, functionNodes).nodeKey;
}

export function equalStringMaps(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}
