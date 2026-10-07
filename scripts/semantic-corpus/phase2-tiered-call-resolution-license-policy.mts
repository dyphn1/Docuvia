export const EVALUATION_LICENSE_POLICY_VERSION =
  "phase2-evaluation-license-v1" as const;

export const EVALUATION_REPOSITORY_LICENSE_POLICY = {
  "github.com/dyphn1/docuvia": "allowed",
  "github.com/nestjs/nest": "allowed",
  "github.com/trailhq/graft": "allowed",
  "github.com/tirth8205/code-review-graph": "allowed",
  "github.com/403errors/repomind": "allowed",
  "github.com/egonex-ai/understand-anything": "allowed",
  "github.com/typescript-language-server/typescript-language-server": "allowed",
  "github.com/onyx-dot-app/onyx": "allowed",
  "github.com/abhigyanpatwari/gitnexus": "excluded",
} as const satisfies Readonly<Record<string, "allowed" | "excluded">>;

export const EXCLUDED_REPOSITORY_PATH_GLOBS = {
  "github.com/onyx-dot-app/onyx": ["ee/**", "**/ee/**"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export interface EvaluationLicenseRow {
  readonly repoId: string;
  readonly callerFilePath?: string;
  readonly targetFilePaths?: readonly string[];
}

export type EvaluationLicenseClassification =
  "allowed" | "excluded-repository" | "excluded-path";

export interface LicensedRowsResult<T> {
  readonly allowedRows: readonly T[];
  readonly excludedRepositoryRowCount: number;
  readonly excludedPathRowCount: number;
}

function canonicalRepoId(repoId: string): string {
  return repoId
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^git@/i, "")
    .replace(":", "/")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function canonicalFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function repoPolicy(repoId: string): "allowed" | "excluded" {
  const canonical = canonicalRepoId(repoId);
  const policy =
    EVALUATION_REPOSITORY_LICENSE_POLICY[
      canonical as keyof typeof EVALUATION_REPOSITORY_LICENSE_POLICY
    ];
  if (!policy)
    throw new Error(
      `Repository ${repoId} is missing from the evaluation license policy.`,
    );
  return policy;
}

export function isExcludedLicensePath(
  repoId: string,
  filePath: string,
): boolean {
  const canonical = canonicalRepoId(repoId);
  const policy = repoPolicy(canonical);
  if (policy === "excluded") return true;
  const globs =
    EXCLUDED_REPOSITORY_PATH_GLOBS[
      canonical as keyof typeof EXCLUDED_REPOSITORY_PATH_GLOBS
    ];
  if (!globs) return false;
  const normalizedPath = canonicalFilePath(filePath);
  return globs.some((glob) => {
    if (glob === "ee/**") return normalizedPath.startsWith("ee/");
    if (glob === "**/ee/**") return /(?:^|\/)ee\//.test(normalizedPath);
    throw new Error(`Unsupported evaluation license path glob: ${glob}.`);
  });
}

export function classifyEvaluationRowLicense(
  row: EvaluationLicenseRow,
): EvaluationLicenseClassification {
  if (repoPolicy(row.repoId) === "excluded") return "excluded-repository";
  const paths = [row.callerFilePath, ...(row.targetFilePaths ?? [])].filter(
    (value): value is string => value !== undefined,
  );
  return paths.some((filePath) => isExcludedLicensePath(row.repoId, filePath))
    ? "excluded-path"
    : "allowed";
}

export function assertEvaluationRowAllowed(row: EvaluationLicenseRow): void {
  const classification = classifyEvaluationRowLicense(row);
  if (classification === "excluded-repository")
    throw new Error(
      `Excluded repository ${row.repoId} reached an evaluation split.`,
    );
  if (classification === "excluded-path")
    throw new Error(
      `Repository ${row.repoId} excluded license path reached an evaluation split.`,
    );
}

export function filterEvaluationRowsByLicense<T extends EvaluationLicenseRow>(
  rows: readonly T[],
): LicensedRowsResult<T> {
  const allowedRows: T[] = [];
  let excludedRepositoryRowCount = 0;
  let excludedPathRowCount = 0;
  for (const row of rows) {
    const classification = classifyEvaluationRowLicense(row);
    if (classification === "excluded-repository") {
      excludedRepositoryRowCount++;
      continue;
    }
    if (classification === "excluded-path") {
      excludedPathRowCount++;
      continue;
    }
    assertEvaluationRowAllowed(row);
    allowedRows.push(row);
  }
  return { allowedRows, excludedRepositoryRowCount, excludedPathRowCount };
}

export function assertEvaluationSplitLicenseAllowed<
  TObservation extends {
    readonly sampleId: string;
    readonly repoId?: string;
    readonly callerFilePath?: string;
  },
  TLabel extends {
    readonly sampleId: string;
    readonly repoId?: string;
    readonly positiveTargetIds: readonly string[];
  },
>(observations: readonly TObservation[], labels: readonly TLabel[]): void {
  const labelsById = new Map(labels.map((label) => [label.sampleId, label]));
  for (const observation of observations) {
    if (!observation.repoId || !observation.callerFilePath)
      throw new Error(
        `Evaluation row ${observation.sampleId} lacks license identity or caller path.`,
      );
    const label = labelsById.get(observation.sampleId);
    if (!label)
      throw new Error(
        `Evaluation row ${observation.sampleId} lacks a label for license validation.`,
      );
    if (
      label.repoId &&
      canonicalRepoId(label.repoId) !== canonicalRepoId(observation.repoId)
    )
      throw new Error(
        `Evaluation row ${observation.sampleId} has mismatched repository identities.`,
      );
    const targetFilePaths = label.positiveTargetIds.map((targetId) => {
      const separator = targetId.indexOf("#");
      return separator < 0 ? targetId : targetId.slice(0, separator);
    });
    assertEvaluationRowAllowed({
      repoId: observation.repoId,
      callerFilePath: observation.callerFilePath,
      targetFilePaths,
    });
  }
}
