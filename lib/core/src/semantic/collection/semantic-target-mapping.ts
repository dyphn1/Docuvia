import {
  DocuviaError,
  ErrorCodes,
  type SemanticDeclarationRef,
  type SemanticOracleAnswer,
  type SemanticOracleOutcome,
} from "@workspace/contracts";
import { buildQualifiedBaseKey } from "../../graph/node-key.js";

function isNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateDeclaration(declaration: SemanticDeclarationRef): void {
  const validLines = [declaration.startLine, declaration.nameLine].every(
    (line) => Number.isInteger(line) && line >= 0,
  );
  const validContainer =
    declaration.containerName === undefined ||
    isNonBlankText(declaration.containerName);
  if (
    !isNonBlankText(declaration.filePath) ||
    !isNonBlankText(declaration.name) ||
    !validLines ||
    !validContainer ||
    typeof declaration.concrete !== "boolean"
  )
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_CORPUS_INVALID,
      "Invalid semantic declaration metadata",
    );
}

/** C-03: first existing key among `base@L<startLine>`, `base@L<nameLine>`, `base`. */
export function mapDeclarationToNodeKey(
  declaration: SemanticDeclarationRef,
  nodeKeys: ReadonlySet<string>,
): string | undefined {
  validateDeclaration(declaration);
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
