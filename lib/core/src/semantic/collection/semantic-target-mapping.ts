import type {
  SemanticDeclarationRef,
  SemanticOracleAnswer,
  SemanticOracleOutcome,
} from "@workspace/contracts";
import { buildQualifiedBaseKey } from "../../graph/node-key.js";

/** C-03: first existing key among `base@L<startLine>`, `base@L<nameLine>`, `base`. */
export function mapDeclarationToNodeKey(
  declaration: SemanticDeclarationRef,
  nodeKeys: ReadonlySet<string>,
): string | undefined {
  const base = buildQualifiedBaseKey(
    declaration.filePath,
    declaration.name,
    declaration.containerName,
  );
  return [
    `${base}@L${declaration.startLine}`,
    `${base}@L${declaration.nameLine}`,
    base,
  ].find((key) => nodeKeys.has(key));
}

type LocationAnswer = Extract<SemanticOracleAnswer, { kind: "locations" }>;

function mapLocations(
  answer: LocationAnswer,
  callerFile: string,
  nodeKeys: ReadonlySet<string>,
): { targets: Set<string>; unmapped: number } {
  const targets = new Set<string>();
  let unmapped = 0;
  for (const location of answer.locations) {
    if (location.external || location.filePath === callerFile) continue;
    const key = location.declaration
      ? mapDeclarationToNodeKey(location.declaration, nodeKeys)
      : undefined;
    if (key === undefined) unmapped++;
    else targets.add(key);
  }
  return { targets, unmapped };
}

/** C-05: classify one `textDocument/definition` answer without inventing negatives. */
export function oracleOutcome(
  answer: SemanticOracleAnswer,
  callerFile: string,
  nodeKeys: ReadonlySet<string>,
): SemanticOracleOutcome {
  if (answer.kind !== "locations")
    return { status: answer.kind, targetIds: [], unmappedLocations: 0 };
  if (answer.locations.length === 0)
    return { status: "empty", targetIds: [], unmappedLocations: 0 };
  const { targets, unmapped } = mapLocations(answer, callerFile, nodeKeys);
  return {
    status: targets.size === 0 ? "unsupported" : "resolved",
    targetIds: [...targets].sort(),
    unmappedLocations: unmapped,
  };
}
