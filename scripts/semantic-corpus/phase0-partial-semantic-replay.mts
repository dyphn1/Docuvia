import { realpathSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import {
  createPartialSemanticProject,
  type PartialSemanticCallSite,
  type PartialSemanticDefinitionRef,
  type PartialSemanticProjectMetadata,
  type PartialSemanticStatus,
} from "./phase0-partial-semantic.mts";

export interface PartialSemanticReplaySite {
  readonly sampleId: string;
  readonly snapshotId: string;
  readonly projectId: string;
  readonly callSiteKey: string | null;
  readonly filePath: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly offsetUtf16: number | null;
  readonly calleeKind: string | null;
  readonly calleeName: string | null;
  readonly positionStatus: string | null;
  readonly exclusionReason?: string;
}

export interface PartialSemanticReplayRow extends PartialSemanticReplaySite {
  readonly evidenceKind: "tier-b0-measurement-only";
  readonly status: PartialSemanticStatus;
  readonly reason: string | null;
  readonly definitions: readonly PartialSemanticDefinitionRef[];
  readonly latencyMs: number | null;
}

export interface PartialSemanticReplayProjectSummary {
  readonly projectId: string;
  readonly status:
    "ready" | "initialization-error" | "query-error" | "snapshot-mismatch";
  readonly inputSiteCount: number;
  readonly queriedSiteCount: number;
  readonly failedSiteCount: number;
  readonly typescriptVersion: string | null;
  readonly languageServiceMode: "PartialSemantic";
  readonly configHash: string | null;
  readonly compilerOptions: {
    readonly noResolve: true;
    readonly types: readonly [];
  };
  readonly rootFiles: readonly string[];
  readonly programFiles: readonly string[];
  readonly startupMs: number | null;
  readonly readyMs: number | null;
  readonly error?: string;
}

export interface ReplayPartialSemanticRowsInput {
  readonly snapshotRoot: string;
  readonly snapshotId: string;
  readonly sites: readonly PartialSemanticReplaySite[];
  readonly snapshotFiles: ReadonlySet<string>;
}

export interface ReplayPartialSemanticRowsResult {
  readonly rows: readonly PartialSemanticReplayRow[];
  readonly projects: readonly PartialSemanticReplayProjectSummary[];
}

const EVIDENCE_KIND = "tier-b0-measurement-only" as const;
const NO_RESOLVE_OPTIONS = { noResolve: true, types: [] as const };
const ABSOLUTE_PATH_PATTERN =
  /(?:[A-Za-z]:[\\/]|\/(?:Users|private|tmp|var|home|opt|workspace)\/)[^\s,;)'\"]*/g;

function outputIdentity(site: PartialSemanticReplaySite) {
  return {
    sampleId: site.sampleId,
    snapshotId: site.snapshotId,
    projectId: site.projectId,
    callSiteKey: site.callSiteKey,
    filePath: site.filePath,
    line: site.line,
    column: site.column,
    offsetUtf16: site.offsetUtf16,
    calleeKind: site.calleeKind,
    calleeName: site.calleeName,
    positionStatus: site.positionStatus,
    ...(site.exclusionReason === undefined
      ? {}
      : { exclusionReason: site.exclusionReason }),
  };
}

function redactedText(value: string, snapshotRoot: string): string {
  const root = path.resolve(snapshotRoot);
  const roots = new Set([root]);
  try {
    roots.add(realpathSync.native(root));
  } catch {
    // The service will report the useful project error below; redaction still covers root.
  }
  let redacted = value;
  for (const alias of roots)
    redacted = redacted.replaceAll(alias, "<snapshot-root>");
  return redacted.replace(ABSOLUTE_PATH_PATTERN, "<absolute-path>");
}

function errorText(error: unknown, snapshotRoot: string): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactedText(message, snapshotRoot);
}

function normalizedDefinitions(
  definitions: readonly PartialSemanticDefinitionRef[],
  snapshotRoot: string,
): readonly PartialSemanticDefinitionRef[] {
  const absoluteRoots = new Set([path.resolve(snapshotRoot)]);
  try {
    absoluteRoots.add(realpathSync.native(path.resolve(snapshotRoot)));
  } catch {
    // Preserve basename-only external normalization if the snapshot disappeared.
  }

  const stableContainer = (value: string | null): string | null => {
    if (value === null) return null;
    return value.replace(ABSOLUTE_PATH_PATTERN, (absolutePath) => {
      const resolvedPath = path.resolve(absolutePath);
      for (const root of absoluteRoots) {
        const relative = path.relative(root, resolvedPath);
        if (
          relative === "" ||
          (relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
        )
          return relative.split(path.sep).join("/");
      }
      const basename = /^[A-Za-z]:[\\/]/.test(absolutePath)
        ? path.win32.basename(absolutePath)
        : path.basename(absolutePath);
      return `<external-path:${basename}>`;
    });
  };

  return definitions.map((definition) => ({
    ...definition,
    containerName: stableContainer(definition.containerName),
  }));
}

function serviceSite(site: PartialSemanticReplaySite): PartialSemanticCallSite {
  return {
    filePath: site.filePath,
    line: site.line,
    column: site.column,
    offsetUtf16: site.offsetUtf16,
    calleeKind: site.calleeKind,
    calleeName: site.calleeName,
    positionStatus: site.positionStatus,
    ...(site.exclusionReason === undefined
      ? {}
      : { exclusionReason: site.exclusionReason }),
  };
}

function metadataSummary(
  projectId: string,
  metadata: PartialSemanticProjectMetadata | undefined,
  snapshotRoot: string,
  status: PartialSemanticReplayProjectSummary["status"],
  inputSiteCount: number,
  queriedSiteCount: number,
  failedSiteCount: number,
  startupMs: number | null,
  error?: string,
): PartialSemanticReplayProjectSummary {
  const relativeMetadataPath = (value: string): string => {
    if (!path.isAbsolute(value)) return value.replaceAll("\\", "/");
    const relative = path.relative(snapshotRoot, value);
    if (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
      return relative.split(path.sep).join("/");
    return `<external-path:${path.basename(value)}>`;
  };

  const safeProjectId =
    projectId.length > 0 &&
    !path.isAbsolute(projectId) &&
    !projectId.split(/[\\/]/).includes("..")
      ? projectId.replaceAll("\\", "/")
      : "<invalid-project-id>";

  return {
    projectId: safeProjectId,
    status,
    inputSiteCount,
    queriedSiteCount,
    failedSiteCount,
    typescriptVersion: metadata?.typescriptVersion ?? ts.version,
    languageServiceMode: "PartialSemantic",
    configHash: metadata?.configHash ?? null,
    compilerOptions: NO_RESOLVE_OPTIONS,
    rootFiles: (metadata?.rootFiles ?? []).map(relativeMetadataPath),
    programFiles: (metadata?.programFiles ?? []).map(relativeMetadataPath),
    startupMs: metadata?.startupMs ?? startupMs,
    readyMs: metadata?.readyMs ?? null,
    ...(error === undefined ? {} : { error }),
  };
}

function errorRow(
  site: PartialSemanticReplaySite,
  reason: string,
  latencyMs: number | null,
): PartialSemanticReplayRow {
  return {
    ...outputIdentity(site),
    evidenceKind: EVIDENCE_KIND,
    status: "error",
    reason,
    definitions: [],
    latencyMs,
  };
}

/** Groups source-only sites into isolated projects, querying every safe site once. */
export function replayPartialSemanticRows(
  input: ReplayPartialSemanticRowsInput,
): ReplayPartialSemanticRowsResult {
  const rows = new Array<PartialSemanticReplayRow>(input.sites.length);
  const grouped = new Map<
    string,
    Array<{ readonly site: PartialSemanticReplaySite; readonly index: number }>
  >();
  input.sites.forEach((site, index) => {
    const group = grouped.get(site.projectId) ?? [];
    group.push({ site, index });
    grouped.set(site.projectId, group);
  });

  const projects: PartialSemanticReplayProjectSummary[] = [];
  for (const [projectId, entries] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "en-US"),
  )) {
    const mismatched = entries.filter(
      ({ site }) => site.snapshotId !== input.snapshotId,
    );
    for (const { site, index } of mismatched)
      rows[index] = {
        ...outputIdentity(site),
        evidenceKind: EVIDENCE_KIND,
        status: "error",
        reason: "site-snapshot-mismatch",
        definitions: [],
        latencyMs: null,
      };

    const queryEntries = entries.filter(
      ({ site }) => site.snapshotId === input.snapshotId,
    );
    if (queryEntries.length === 0) {
      projects.push(
        metadataSummary(
          projectId,
          undefined,
          input.snapshotRoot,
          "snapshot-mismatch",
          entries.length,
          0,
          mismatched.length,
          null,
        ),
      );
      continue;
    }

    const projectStarted = performance.now();
    let project;
    try {
      project = createPartialSemanticProject({
        snapshotRoot: input.snapshotRoot,
        projectId,
        snapshotFiles: input.snapshotFiles,
      });
    } catch (error) {
      const reason = errorText(error, input.snapshotRoot);
      for (const { site, index } of queryEntries)
        rows[index] = errorRow(site, reason, null);
      projects.push(
        metadataSummary(
          projectId,
          undefined,
          input.snapshotRoot,
          "initialization-error",
          entries.length,
          0,
          entries.length,
          performance.now() - projectStarted,
          reason,
        ),
      );
      continue;
    }

    let queriedSiteCount = 0;
    let failedSiteCount = mismatched.length;
    let queryError: string | undefined;
    try {
      for (const { site, index } of queryEntries) {
        queriedSiteCount += 1;
        const queryStarted = performance.now();
        try {
          const result = project.query(serviceSite(site));
          const reason =
            result.reason === null
              ? null
              : errorText(result.reason, input.snapshotRoot);
          rows[index] = {
            ...outputIdentity(site),
            evidenceKind: EVIDENCE_KIND,
            status: result.status,
            reason,
            definitions: normalizedDefinitions(
              result.definitions,
              input.snapshotRoot,
            ),
            latencyMs: result.latencyMs,
          };
          if (result.status === "error") {
            failedSiteCount += 1;
            queryError ??= reason ?? "partial-semantic-query-failed";
          }
        } catch (error) {
          const reason = errorText(error, input.snapshotRoot);
          rows[index] = errorRow(
            site,
            reason,
            performance.now() - queryStarted,
          );
          failedSiteCount += 1;
          queryError ??= reason;
        }
      }
    } finally {
      try {
        project.close();
      } catch (error) {
        queryError ??= errorText(error, input.snapshotRoot);
      }
    }

    projects.push(
      metadataSummary(
        projectId,
        project.metadata,
        input.snapshotRoot,
        queryError ? "query-error" : "ready",
        entries.length,
        queriedSiteCount,
        failedSiteCount,
        project.metadata.startupMs,
        queryError,
      ),
    );
  }

  return { rows, projects };
}
