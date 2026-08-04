import type { L2NodeRow, L3NodeRow, NodeLinkRow } from "@workspace/contracts";
import { LinkTypes } from "@workspace/contracts";
import { GitConstants } from "./git-constants.js";

/** Extension applied to every rendered L2 markdown file (mirrors `snapshot-renderer.service.ts`'s own constant of the same purpose). */
const MARKDOWN_FILE_EXTENSION = ".md";

/** Characters illegal (or reserved) in filenames on common filesystems, plus ASCII control chars — mirrors `snapshot-renderer.service.ts`'s identically-named constant. */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f\s]/g;
const CURRENT_DIR_SEGMENT = ".";
const PARENT_DIR_SEGMENT = "..";

/** Windows/DOS reserved device names — mirrors `snapshot-renderer.service.ts`'s identically-named
 *  constant (see its doc comment for why: git's `core.protectNTFS` rejects a tree path built from
 *  one of these on every platform, not just Windows). Must stay in lockstep with that file's
 *  `sanitizeSegment` so an L3 card's `l2_path` frontmatter field always matches the real rendered
 *  path of the L2 node it references (L3DIST-007 resolves `l2_path` back to a node by exact match). */
const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com0",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt0",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);
const RESERVED_NAME_MANGLE_SUFFIX = "_" as const;

function sanitizeSegment(segment: string): string {
  let replaced = segment.replace(ILLEGAL_FILENAME_CHARS, "_");
  if (replaced.length > 100) replaced = replaced.slice(0, 100);
  const dotIndex = replaced.indexOf(".");
  const namePart = dotIndex === -1 ? replaced : replaced.slice(0, dotIndex);
  if (!WINDOWS_RESERVED_DEVICE_NAMES.has(namePart.toLowerCase()))
    return replaced;
  return dotIndex === -1
    ? `${namePart}${RESERVED_NAME_MANGLE_SUFFIX}`
    : `${namePart}${RESERVED_NAME_MANGLE_SUFFIX}${replaced.slice(dotIndex)}`;
}

/** Posix (`/`-joined) counterpart of `snapshot-renderer.service.ts`'s `sanitizeRelativePath` —
 *  an L3 card's `l2_path` frontmatter field must be OS-independent (it's compared byte-for-byte
 *  across clones), unlike that function's on-disk, `path.sep`-joined output. */
function sanitizeRelativePathPosix(relPath: string): string {
  return relPath
    .split(/[\\/]+/)
    .filter(
      (segment) =>
        segment.length > 0 &&
        segment !== CURRENT_DIR_SEGMENT &&
        segment !== PARENT_DIR_SEGMENT,
    )
    .map(sanitizeSegment)
    .join("/");
}

/** Posix counterpart of `path.parse(x).name`/`path.parse(x).dir` for a `/`-joined relative path. */
function posixParse(relPath: string): { dir: string; base: string } {
  const slashIdx = relPath.lastIndexOf("/");
  const dir = slashIdx === -1 ? "" : relPath.slice(0, slashIdx);
  const base = slashIdx === -1 ? relPath : relPath.slice(slashIdx + 1);
  const dotIdx = base.lastIndexOf(".");
  const name = dotIdx <= 0 ? base : base.slice(0, dotIdx);
  return { dir, base: name };
}

/**
 * The git-relative (posix, `knowledge/`-prefixed) markdown path a file/symbol node renders to —
 * the exact same algorithm as `snapshot-renderer.service.ts`'s `markdownPathFor`, restated in
 * posix form and without resolving against an on-disk directory, since this value is packed as
 * plain text into an L3 card's `l2_path` field (L3DIST-004), not used for a filesystem write.
 * `undefined` when `node.filePath` is missing, mirroring `markdownPathFor`'s own contract.
 */
function l2GitPathFor(
  node: { name: string; filePath?: string },
  isSymbol: boolean,
): string | undefined {
  if (!node.filePath) return undefined;
  const sanitized = sanitizeRelativePathPosix(node.filePath);

  if (!isSymbol) {
    return `${GitConstants.KNOWLEDGE_DIR_NAME}/${sanitized}${MARKDOWN_FILE_EXTENSION}`;
  }

  const { dir, base } = posixParse(sanitized);
  const safeName = sanitizeSegment(node.name);
  const relDir = dir ? `${dir}/${base}` : base;
  return `${GitConstants.KNOWLEDGE_DIR_NAME}/${relDir}/${safeName}${MARKDOWN_FILE_EXTENSION}`;
}

function parsePathPattern(raw: string | null): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);
  } catch (e) {
    void e;
  }
  return raw;
}

/**
 * `l3_nodes.l2_node_id` (a local rowid) -> that L2 node's git-relative markdown path — the
 * `l2_path` value `snapshot`'s L3 card renderer stamps onto each card (L3DIST-004). Reuses the
 * exact node-classification algorithm `SnapshotRendererService.render()` already applies to
 * `l2Rows`/`linkRows` (file vs. symbol, containing-file resolution), restated here in posix form.
 */
export function computeL2GitPathsByNodeId(
  l2Rows: L2NodeRow[],
  linkRows: NodeLinkRow[],
): Map<number, string> {
  const filePathById = new Map<number, string | undefined>();
  for (const row of l2Rows)
    filePathById.set(row.id, parsePathPattern(row.path_patterns));

  const containingFileIdByNodeId = new Map<number, number>();
  for (const link of linkRows) {
    if (link.link_type === LinkTypes.CONTAINS) {
      containingFileIdByNodeId.set(link.target_node_id, link.source_node_id);
    }
  }

  const result = new Map<number, string>();
  for (const row of l2Rows) {
    const containingFileId = containingFileIdByNodeId.get(row.id);
    const filePath =
      containingFileId !== undefined
        ? filePathById.get(containingFileId)
        : filePathById.get(row.id);
    const gitPath = l2GitPathFor(
      { name: row.name, filePath },
      containingFileId !== undefined,
    );
    if (gitPath) result.set(row.id, gitPath);
  }
  return result;
}

/**
 * `nodeKey` -> that L2 node's git-relative markdown path — the hydrate-side counterpart of
 * `computeL2GitPathsByNodeId`, operating on the already-rendered `graph/nodes.jsonl`/
 * `edges.jsonl` shape (`nodeKey`-keyed, `filePath` already resolved to the containing file for
 * symbol nodes) instead of raw `l2_nodes`/`node_links` rows. Used to resolve an L3 card's
 * `l2_path` back to a `nodeKey`, then to a *local* `l2_node_id` via
 * `IGraphNodesRepo.findNodeIdByNodeKey` (L3DIST-007) — this is what makes the resolution portable
 * across clones instead of depending on a non-portable local rowid.
 */
export function computeL2GitPathsByNodeKey(
  nodes: Array<{ nodeKey: string; name: string; filePath?: string }>,
  edges: Array<{ source: string; target: string; type: string }>,
): Map<string, string> {
  const containingKeyByKey = new Map<string, string>();
  for (const edge of edges) {
    if (edge.type === LinkTypes.CONTAINS) {
      containingKeyByKey.set(edge.target, edge.source);
    }
  }

  const result = new Map<string, string>();
  for (const node of nodes) {
    const isSymbol = containingKeyByKey.has(node.nodeKey);
    const gitPath = l2GitPathFor(
      { name: node.name, filePath: node.filePath },
      isSymbol,
    );
    if (gitPath) result.set(node.nodeKey, gitPath);
  }
  return result;
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** The exact frontmatter field set L3DIST-002 allows onto a packed card — every field here is
 *  immutable after the row's first insert; nothing that mutates on re-analysis
 *  (`occurrence_count`, `last_verified_at`, post-creation `source_commits` growth, L3DIST-003)
 *  is included. */
export interface L3CardFrontmatter {
  content_hash: string;
  node_type: string;
  title: string;
  l2_path: string;
  source_commits: string[];
  extraction_model: string | null;
  source_files: string[];
  created_at: string;
}

export interface ParsedL3Card extends L3CardFrontmatter {
  content: string;
}

/**
 * Renders a single `l3_nodes` row into an L3 card's full markdown text (frontmatter + body),
 * L3DIST-001/002. The frontmatter is a fenced JSON block (`---\n{...}\n---\n\n`), not
 * line-oriented `key: value` pairs like `SnapshotRendererService`'s L2 frontmatter — L3
 * title/content come from LLM extraction and can contain arbitrary characters (colons, newlines)
 * that a hand-rolled `key: value` parser can't round-trip safely; JSON handles that for free
 * without pulling in a YAML dependency. `JSON.stringify`'s key order is the object literal's
 * insertion order (deterministic across runs), and `source_commits` is always the row's
 * `initial_source_commits` (falling back to `source_commits` for a pre-migration row that never
 * had the frozen column populated) — together these are what make an unchanged row's rendered
 * card byte-identical run-over-run (L3DIST edge case 5b).
 */
export function renderL3Card(row: L3NodeRow, l2Path: string): string {
  const frontmatter: L3CardFrontmatter = {
    content_hash: row.content_hash ?? "",
    node_type: row.node_type,
    title: row.title,
    l2_path: l2Path,
    source_commits: parseJsonStringArray(
      row.initial_source_commits ?? row.source_commits,
    ),
    extraction_model: row.extraction_model,
    source_files: parseJsonStringArray(row.source_files),
    created_at: row.created_at,
  };
  const body = row.content ?? "";
  return `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${body}\n`;
}

const L3_CARD_PATTERN = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/;

/** Parses an L3 card's markdown text back into its frontmatter + body — `renderL3Card`'s inverse.
 *  `undefined` for anything that doesn't match the fenced-JSON-frontmatter shape (a malformed or
 *  foreign file that happened to land under `knowledge/_l3/`), so callers skip it rather than
 *  throw (mirrors `HydrationService`'s general "a bad git object never fails the whole hydrate"
 *  posture). */
export function parseL3Card(raw: string): ParsedL3Card | undefined {
  const match = L3_CARD_PATTERN.exec(raw);
  if (!match) return undefined;

  try {
    const frontmatter = JSON.parse(match[1]) as L3CardFrontmatter;
    if (
      typeof frontmatter.content_hash !== "string" ||
      typeof frontmatter.l2_path !== "string"
    ) {
      return undefined;
    }
    // `renderL3Card` always appends exactly one trailing "\n" after the body; strip it back off
    // so a round trip reproduces the original `row.content` exactly.
    const content = match[2].endsWith("\n") ? match[2].slice(0, -1) : match[2];
    return { ...frontmatter, content };
  } catch {
    return undefined;
  }
}
