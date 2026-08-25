import {
  ValidityStatuses,
  type IGraphStore,
  type IGitProvider,
  type ILineBlameProvider,
  type ILogger,
  type L3AnchorRange,
  type L3NodeRow,
} from "@workspace/contracts";

/** `docuvia_meta` key for the validity pass's cursor: the source HEAD sha last judged. */
const VALIDITY_JUDGED_SHA_KEY = "l3ValidityJudgedSha";

export interface L3ValidityPassResult {
  /** Rows whose status actually flipped to `active` (survived blame). */
  activated: number;
  /** Rows demoted to `garbage` ("dead/superseded") — blame shows the writing commit no longer owns the described lines. */
  superseded: number;
  /** True when this run only stamped the baseline cursor (no prior pass ever ran) and judged nothing. */
  baseline: boolean;
}

interface ParsedAnchors {
  ranges: L3AnchorRange[];
}

function parseAnchors(row: L3NodeRow): ParsedAnchors | null {
  if (!row.anchor_ranges) return null;
  try {
    const parsed: unknown = JSON.parse(row.anchor_ranges);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return { ranges: parsed as L3AnchorRange[] };
  } catch {
    return null;
  }
}

function parseCommits(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * A range survives if at least one line inside it is still owned by one of the decision's own
 * source commits (`source_commits` ∪ `initial_source_commits`). A full rewrite of the region
 * re-owns every line and kills the rationale; a partial edit that leaves any original line
 * keeps it. Ranges on files not re-examined this pass (untouched since the cursor, or blame
 * unavailable) count as surviving -- the pass judges only what it can see.
 */
function rangeSurvives(
  range: L3AnchorRange,
  ownersByFile: Map<string, Map<number, string>>,
  knownCommits: Set<string>,
): boolean {
  const owners = ownersByFile.get(range.path);
  // Untouched-since-cursor, or blame yielded nothing (`getBlameLineOwners`'s empty-map
  // contract means "unknown ownership"): neither is evidence of death.
  if (!owners || owners.size === 0) return true;
  for (let line = range.startRow + 1; line <= range.endRow + 1; line++) {
    const owner = owners.get(line);
    if (owner && knownCommits.has(owner)) return true;
  }
  return false;
}

/** The per-row judging loop, split out of `runL3ValidityPass` purely to keep it under the
 *  project's ESLint complexity budget (same pattern as the flush workflow's helper split). */
function judgeCandidates(
  store: IGraphStore,
  candidates: Array<{ row: L3NodeRow; anchors: ParsedAnchors }>,
  ownersByFile: Map<string, Map<number, string>>,
  judgedFiles: Set<string>,
): { activated: number; superseded: number } {
  let activated = 0;
  let superseded = 0;
  for (const { row, anchors } of candidates) {
    // Skip rows none of whose regions are under examination this pass.
    if (!anchors.ranges.some((range) => judgedFiles.has(range.path))) continue;

    const knownCommits = new Set([
      ...parseCommits(row.source_commits),
      ...parseCommits(row.initial_source_commits),
      ...(row.commit_hash ? [row.commit_hash] : []),
    ]);
    const alive = anchors.ranges.every((range) =>
      rangeSurvives(range, ownersByFile, knownCommits),
    );
    const nextStatus = alive
      ? ValidityStatuses.ACTIVE
      : ValidityStatuses.GARBAGE;
    if (nextStatus === row.validity_status) continue;
    store.l3.updateValidityStatus(row.id, nextStatus);
    if (alive) activated++;
    else superseded++;
  }
  return { activated, superseded };
}

/**
 * Issue #68's authority judgment, run against the current HEAD tree (which is the merge result
 * by the time any local run observes it). For every anchored L3 decision on a file changed
 * since the previous pass, `git blame` decides whether the writing commit still owns the lines
 * it describes: all ranges surviving -> `active`, any range fully re-owned -> `garbage`
 * ("dead/superseded" -- demoted, still queryable with an explicit validity attribute).
 *
 * Cursor semantics (`docuvia_meta['l3ValidityJudgedSha']`): the first-ever run stamps the
 * baseline without judging anything (pre-existing rows were written by commits already in
 * history; there is no meaningful "since" to diff), and every later run judges
 * `cursor..HEAD` then advances the cursor. Deterministic, zero LLM, cost bounded to blaming
 * only the anchored files that actually changed.
 */
export async function runL3ValidityPass(deps: {
  workspaceRoot: string;
  logger: ILogger;
  store: IGraphStore;
  git: Pick<IGitProvider, "getHeadSha" | "getChangedFilesSince">;
  blame: ILineBlameProvider;
}): Promise<L3ValidityPassResult> {
  const { workspaceRoot, logger, store, git, blame } = deps;

  const headSha = await git.getHeadSha(workspaceRoot);
  const result: L3ValidityPassResult = {
    activated: 0,
    superseded: 0,
    baseline: false,
  };
  if (!headSha) return result;

  const previousSha = store.meta.get(VALIDITY_JUDGED_SHA_KEY);
  if (previousSha === headSha) return result;
  if (!previousSha) {
    store.meta.set(VALIDITY_JUDGED_SHA_KEY, headSha);
    result.baseline = true;
    return result;
  }

  const candidates = store.l3
    .getAllExportable()
    .map((row) => ({ row, anchors: parseAnchors(row) }))
    .filter(
      (entry): entry is { row: L3NodeRow; anchors: ParsedAnchors } =>
        entry.anchors !== null &&
        // Judge only undecided or live rows; garbage ("dead") never resurrects, and
        // `draft` rows belong to their author's in-progress editing flow, not this pass.
        (entry.row.validity_status === ValidityStatuses.PENDING ||
          entry.row.validity_status === ValidityStatuses.ACTIVE),
    );
  if (candidates.length === 0) {
    store.meta.set(VALIDITY_JUDGED_SHA_KEY, headSha);
    return result;
  }

  const anchoredPaths = new Set(
    candidates.flatMap((entry) => entry.anchors.ranges.map((r) => r.path)),
  );
  const changedFiles = new Set(
    (await git.getChangedFilesSince(workspaceRoot, previousSha, "HEAD")).map(
      (entry) => entry.file,
    ),
  );
  const filesToJudge = [...anchoredPaths].filter((p) => changedFiles.has(p));

  const ownersByFile = new Map<string, Map<number, string>>();
  for (const filePath of filesToJudge) {
    ownersByFile.set(
      filePath,
      await blame.getBlameLineOwners(workspaceRoot, filePath),
    );
  }

  const judgedFiles = new Set(filesToJudge);
  const flips = judgeCandidates(store, candidates, ownersByFile, judgedFiles);
  result.activated = flips.activated;
  result.superseded = flips.superseded;

  store.meta.set(VALIDITY_JUDGED_SHA_KEY, headSha);
  return result;
}
