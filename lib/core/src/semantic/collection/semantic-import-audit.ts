import path from "node:path";
import type { SemanticSourceAuditResult } from "@workspace/contracts";

/** C-04 syntactic source audit: import tracing without the type checker. */
export interface ImportBinding {
  readonly local: string;
  /** Imported name, `default`, or `*` for a namespace import. */
  readonly imported: string;
  readonly specifier: string;
}

export interface ReexportSyntax {
  /** Exported name, or `*` for `export * from`. */
  readonly exported: string;
  readonly imported: string;
  readonly specifier: string;
}

export interface ModuleSyntax {
  readonly declared: readonly string[];
  /** Declared class names; a static call is auditable only on an imported class. */
  readonly classes: readonly string[];
  readonly reexports: readonly ReexportSyntax[];
}

export interface ImportAuditInput {
  readonly callerFile: string;
  readonly calleeName: string;
  readonly calleeKind: string | null;
  readonly receiverText: string | null;
  readonly imports: readonly ImportBinding[];
  readonly goldFiles: readonly string[];
  readonly fileExists: (file: string) => boolean;
  readonly moduleOf: (file: string) => ModuleSyntax | undefined;
}

const MAX_REEXPORT_DEPTH = 5;
const NAMESPACE = "*";
const DEFAULT_EXPORT = "default";
const JS_TO_TS: Readonly<Record<string, string>> = {
  ".js": ".ts",
  ".jsx": ".tsx",
  ".mjs": ".mts",
  ".cjs": ".cts",
};
const PROBE_SUFFIXES = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

function isRelative(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

/** Relative-only module resolution; bare/`paths` specifiers are deliberately unresolved. */
export function resolveRelativeSpecifier(
  fromFile: string,
  specifier: string,
  fileExists: (file: string) => boolean,
): string | undefined {
  if (!isRelative(specifier)) return undefined;
  const joined = path.posix.join(path.posix.dirname(fromFile), specifier);
  if (joined.startsWith("..")) return undefined;
  const extension = path.posix.extname(joined);
  const swapped = JS_TO_TS[extension];
  const probes = swapped
    ? [joined.slice(0, -extension.length) + swapped, joined]
    : [
        ...(extension ? [joined] : []),
        ...PROBE_SUFFIXES.map((s) => joined + s),
      ];
  return probes.find(fileExists);
}

function starExport(
  input: ImportAuditInput,
  file: string,
  reexports: readonly ReexportSyntax[],
  name: string,
  depth: number,
): string | undefined {
  const found = new Set<string>();
  for (const entry of reexports.filter((r) => r.exported === NAMESPACE)) {
    const next = resolveRelativeSpecifier(
      file,
      entry.specifier,
      input.fileExists,
    );
    const result = next && findExport(input, next, name, depth + 1);
    if (result) found.add(result);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

function findExport(
  input: ImportAuditInput,
  file: string,
  name: string,
  depth: number,
): string | undefined {
  if (depth > MAX_REEXPORT_DEPTH) return undefined;
  if (name === DEFAULT_EXPORT) return file;
  const module = input.moduleOf(file);
  if (!module) return undefined;
  if (module.declared.includes(name)) return file;
  const explicit = module.reexports.find((r) => r.exported === name);
  if (!explicit) return starExport(input, file, module.reexports, name, depth);
  const next = resolveRelativeSpecifier(
    file,
    explicit.specifier,
    input.fileExists,
  );
  return next && findExport(input, next, explicit.imported, depth + 1);
}

function notApplicable(reason: string): SemanticSourceAuditResult {
  return { kind: "not-applicable", reason };
}

function traced(
  input: ImportAuditInput,
  binding: ImportBinding,
  exportName: string,
  requireClass = false,
): SemanticSourceAuditResult {
  const file = resolveRelativeSpecifier(
    input.callerFile,
    binding.specifier,
    input.fileExists,
  );
  if (!file) return notApplicable("unresolved-specifier");
  const declaring = findExport(input, file, exportName, 0);
  if (!declaring) return notApplicable("export-not-found");
  if (requireClass && !input.moduleOf(declaring)?.classes.includes(exportName))
    return notApplicable("receiver-not-a-class");
  return input.goldFiles.includes(declaring)
    ? { kind: "match", filePath: declaring }
    : { kind: "mismatch", filePath: declaring };
}

function auditBare(input: ImportAuditInput): SemanticSourceAuditResult {
  const binding = input.imports.find((b) => b.local === input.calleeName);
  if (!binding) return notApplicable("callee-not-imported");
  if (binding.imported === NAMESPACE) return notApplicable("namespace-called");
  return traced(input, binding, binding.imported);
}

function auditMember(input: ImportAuditInput): SemanticSourceAuditResult {
  const binding = input.imports.find((b) => b.local === input.receiverText);
  if (!binding) return notApplicable("receiver-not-imported");
  return binding.imported === NAMESPACE
    ? traced(input, binding, input.calleeName)
    : traced(input, binding, binding.imported, true);
}

/** C-04: trace the callee's import to its declaring file and compare with the gold files. */
export function auditImportedTarget(
  input: ImportAuditInput,
): SemanticSourceAuditResult {
  if (input.calleeKind === "bare") return auditBare(input);
  if (input.calleeKind === "member" && input.receiverText)
    return auditMember(input);
  return notApplicable("unsupported-callee-kind");
}
