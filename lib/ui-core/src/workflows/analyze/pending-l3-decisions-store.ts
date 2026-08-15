import fs from "fs/promises";
import path from "path";
import {
  DOCUVIA_DIR_NAME,
  PENDING_L3_DECISIONS_FILE_NAME,
  UTF8_ENCODING,
  type ILogger,
} from "@workspace/contracts";
import { toNodeKey } from "./anchor-resolution.js";
import type { ExtractedDecision } from "./analyze-result.js";

const PENDING_L3_DECISIONS_STORE_MESSAGES = {
  CORRUPT_FILE: (filePath: string) =>
    `Could not parse ${filePath} -- treating staged L3 decisions as empty`,
} as const;

/**
 * One `analyze <targetPath> --agent-authored --stage` call's worth of a single decision (issue
 * #42, Decision 2's two-stage stage-and-flush design §8.1). `filePath` is always the node_key
 * form -- forward-slash, workspace-relative (`toNodeKey(path.relative(workspaceRoot,
 * path.resolve(workspaceRoot, targetPath)))`, mirroring `resolveAnchorL2NodeId`'s own
 * normalization) -- so it can be compared exactly against `IGitProvider.getFilesChangedByCommit`'s
 * output (`git diff-tree`'s repo-relative, forward-slash paths) in `run-flush-staged-l3.ts`
 * without a Windows-backslash mismatch silently making an entry never flush.
 */
export interface PendingL3Decision {
  filePath: string;
  title: string;
  content: string;
  nodeType: string;
  confidence: number;
  stagedAt: string;
}

function resolvePendingPath(workspaceRoot: string): string {
  return path.join(
    workspaceRoot,
    DOCUVIA_DIR_NAME,
    PENDING_L3_DECISIONS_FILE_NAME,
  );
}

/** A file whose top-level JSON value isn't `{ decisions: [...] }` is treated the same as
 *  unparseable JSON -- neither is a shape this store can trust. */
function isValidShape(
  value: unknown,
): value is { decisions: PendingL3Decision[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { decisions?: unknown }).decisions)
  );
}

/**
 * `.docuvia/pending-l3-decisions.json`'s read (issue #42 §8.1) -- mirrors `hooks-config-store.ts`'s
 * shape exactly: plain `fs` ops, no `docuviaFactory` token, never throws. Missing file -> `[]`
 * (never staged anything yet). Unparseable/wrong-shape file -> warn and treat as `[]` -- the next
 * `--stage` call starts fresh rather than crashing or silently overwriting a file this function
 * can't trust.
 */
export async function readPendingDecisions(
  workspaceRoot: string,
  logger: ILogger,
): Promise<PendingL3Decision[]> {
  const filePath = resolvePendingPath(workspaceRoot);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, UTF8_ENCODING);
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(PENDING_L3_DECISIONS_STORE_MESSAGES.CORRUPT_FILE(filePath));
    return [];
  }
  if (!isValidShape(parsed)) {
    logger.warn(PENDING_L3_DECISIONS_STORE_MESSAGES.CORRUPT_FILE(filePath));
    return [];
  }

  return parsed.decisions;
}

/**
 * Appends one `PendingL3Decision` per `decisions` entry (read-modify-write, so a corrupt existing
 * file self-heals to "just this call's entries" rather than erroring) -- `analyze <targetPath>
 * --agent-authored --stage`'s write path (issue #42 §8.1). `mkdir(recursive: true)`s `.docuvia/`
 * first, same edge case as `writeHookEnabled` (`hooks-config-store.ts`): `docuvia analyze --stage`
 * may run before `docuvia init` ever has.
 */
export async function stagePendingDecisions(
  workspaceRoot: string,
  targetPath: string,
  decisions: ExtractedDecision[],
  logger: ILogger,
): Promise<{ staged: number }> {
  const filePath = toNodeKey(
    path.relative(workspaceRoot, path.resolve(workspaceRoot, targetPath)),
  );
  const current = await readPendingDecisions(workspaceRoot, logger);
  const stagedAt = new Date().toISOString();
  const appended: PendingL3Decision[] = decisions.map((decision) => ({
    filePath,
    title: decision.title,
    content: decision.content,
    nodeType: decision.nodeType,
    confidence: decision.confidence,
    stagedAt,
  }));

  await writePendingDecisions(workspaceRoot, [...current, ...appended]);
  return { staged: appended.length };
}

/**
 * Wholesale-rewrites the staging file to exactly `decisions` -- the flush step's own primitive
 * (`run-flush-staged-l3.ts`), called only after every one of a flush's persist calls has
 * succeeded (durability-before-dequeue: a mid-loop failure must leave the file as it was, not
 * drop the unflushed remainder -- see that module's doc comment). Also the shared write primitive
 * `stagePendingDecisions` itself uses for its own read-modify-write.
 */
export async function writePendingDecisions(
  workspaceRoot: string,
  decisions: PendingL3Decision[],
): Promise<void> {
  await fs.mkdir(path.join(workspaceRoot, DOCUVIA_DIR_NAME), {
    recursive: true,
  });
  await fs.writeFile(
    resolvePendingPath(workspaceRoot),
    `${JSON.stringify({ decisions }, null, 2)}\n`,
    UTF8_ENCODING,
  );
}
