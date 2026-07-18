/**
 * §9e's commit semantic filter (E4) -- a pure, deliberately dumb denylist + regex + length-floor
 * gate applied at *enqueue* time (not consumption time), so junk candidates never occupy Tier C
 * queue space. No LLM pre-classification: spending budget to save budget is self-defeating.
 */

const DEFAULT_DENYLIST_TYPES: ReadonlySet<string> = new Set([
  "chore",
  "style",
  "ci",
  "build",
  "docs",
  "test",
]);

const DEFAULT_MIN_SUBJECT_LENGTH = 10;

/** Matches a "junk" subject line regardless of any conventional-commit type prefix. */
const DROP_SUBJECT_PATTERN =
  /^(wip|fixup!|squash!|typo|lint|format|merge branch)/i;

/** `type(scope)!: subject` or `type: subject` -- captures the type and the subject after the
 *  prefix. A message with no such prefix has no `type` (never denylist-dropped on that basis) and
 *  its whole subject line counts toward the length floor. */
const CONVENTIONAL_COMMIT_PATTERN = /^([A-Za-z]+)(\([^)]*\))?!?:\s*(.*)$/;

export interface TierCCommitFilterOptions {
  denylistTypes?: ReadonlySet<string>;
  minSubjectLength?: number;
}

/** The first (subject) line of a commit message, trimmed -- `""` for an empty message. */
function extractSubjectLine(commitMessage: string): string {
  return commitMessage.split("\n")[0]?.trim() ?? "";
}

/** `true` when `match`'s captured conventional-commit type is in `denylistTypes` -- `false` for
 *  both "no denylisted type" and "no conventional-commit prefix at all" (a message with no such
 *  prefix is never denylist-dropped on that basis, per §9e). */
function isDenylistedType(
  match: RegExpMatchArray | null,
  denylistTypes: ReadonlySet<string>,
): boolean {
  const type = match?.[1]?.toLowerCase();
  return Boolean(type && denylistTypes.has(type));
}

/** The subject text after stripping any conventional-commit `type(scope)!:` prefix -- the whole
 *  subject line when there is no such prefix. */
function stripTypePrefix(
  subjectLine: string,
  match: RegExpMatchArray | null,
): string {
  return (match ? match[3] : subjectLine).trim();
}

/**
 * `true` when `commitMessage`'s subject line should be enqueued as a Tier C candidate; `false`
 * when it matches any of §9e's three drop rules:
 *   1. conventional-commit type in the (config-overridable) denylist.
 *   2. subject matches the junk-pattern regex.
 *   3. subject (after stripping any type prefix) is under `minSubjectLength` characters.
 */
export function shouldEnqueueCommitMessage(
  commitMessage: string,
  options: TierCCommitFilterOptions = {},
): boolean {
  const denylistTypes = options.denylistTypes ?? DEFAULT_DENYLIST_TYPES;
  const minSubjectLength =
    options.minSubjectLength ?? DEFAULT_MIN_SUBJECT_LENGTH;

  const subjectLine = extractSubjectLine(commitMessage);
  if (DROP_SUBJECT_PATTERN.test(subjectLine)) return false;

  const match = subjectLine.match(CONVENTIONAL_COMMIT_PATTERN);
  if (isDenylistedType(match, denylistTypes)) return false;

  return stripTypePrefix(subjectLine, match).length >= minSubjectLength;
}
