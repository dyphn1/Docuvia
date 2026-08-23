import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  IGraphStore,
  IGitProvider,
  L3NodeRow,
} from "@workspace/contracts";
import { runL3ValidityPass } from "./judge-l3-validity.js";

const HEAD = "head-sha-2";
const PREV = "head-sha-1";

function makeRow(overrides: Partial<L3NodeRow> = {}): L3NodeRow {
  return {
    id: 1,
    l2_node_id: 10,
    title: "switched to JWT",
    content: "stateless auth",
    node_type: "decision",
    source_commits: JSON.stringify([PREV]),
    commit_hash: PREV,
    ai_generated: 1,
    confidence: 0.9,
    noise_score: null,
    created_at: "2026-08-23 00:00:00",
    last_verified_at: null,
    occurrence_count: 1,
    introduced_in_commit: null,
    verified_until_commit: null,
    validity_status: "pending",
    source: "agent-authored",
    content_hash: null,
    extraction_model: null,
    source_files: null,
    initial_source_commits: null,
    anchor_ranges: JSON.stringify([
      { path: "src/auth.ts", startRow: 9, endRow: 14 },
    ]),
    ...overrides,
  };
}

interface DepsOverrides {
  store?: Partial<IGraphStore>;
  headSha?: string | undefined;
  changedFiles?: string[];
  blameByFile?: Record<string, Map<number, string>>;
  rows?: L3NodeRow[];
  cursor?: string;
}

function makeDeps(overrides: DepsOverrides = {}) {
  const meta = { get: vi.fn().mockReturnValue(overrides.cursor), set: vi.fn() };
  const l3 = {
    getAllExportable: vi.fn().mockReturnValue(overrides.rows ?? [makeRow()]),
    updateValidityStatus: vi.fn(),
  };
  // The pass only touches `meta` and `l3` on the store interface.
  const store = { meta, l3 } as unknown as IGraphStore;
  return {
    workspaceRoot: "/ws",
    logger: { warn: vi.fn(), info: vi.fn() } as never,
    store,
    git: {
      getHeadSha: vi.fn().mockResolvedValue(overrides.headSha ?? HEAD),
      getChangedFilesSince: vi.fn().mockResolvedValue(
        (overrides.changedFiles ?? ["src/auth.ts"]).map((file) => ({
          file,
          status: "M",
        })),
      ),
    } as unknown as Pick<IGitProvider, "getHeadSha" | "getChangedFilesSince">,
    blame: {
      getBlameLineOwners: vi
        .fn()
        .mockImplementation(
          async (_c, filePath) =>
            overrides.blameByFile?.[filePath] ?? new Map(),
        ),
    },
  };
}

describe("runL3ValidityPass()", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("first-ever run stamps the baseline cursor and judges nothing", async () => {
    const result = await runL3ValidityPass(deps);

    expect(result).toMatchObject({
      baseline: true,
      activated: 0,
      superseded: 0,
    });
    expect(deps.store.meta.set).toHaveBeenCalledWith(
      "l3ValidityJudgedSha",
      HEAD,
    );
    expect(deps.store.l3.updateValidityStatus).not.toHaveBeenCalled();
  });

  it("no-op when HEAD equals the cursor", async () => {
    const sameCursor = makeDeps({ cursor: HEAD });
    const result = await runL3ValidityPass(sameCursor);

    expect(result.baseline).toBe(false);
    expect(sameCursor.store.l3.updateValidityStatus).not.toHaveBeenCalled();
  });

  it("activates a pending row whose anchor lines still blame to its own commit", async () => {
    // Lines 10..15 (1-indexed view of rows 9..14) owned by the writing commit.
    const owners = new Map<number, string>();
    for (let l = 10; l <= 15; l++) owners.set(l, PREV);
    const judging = makeDeps({
      cursor: PREV,
      blameByFile: { "src/auth.ts": owners },
    });

    const result = await runL3ValidityPass(judging);

    expect(result.activated).toBe(1);
    expect(judging.store.l3.updateValidityStatus).toHaveBeenCalledWith(
      1,
      "active",
    );
  });

  it("demotes a row whose whole region was re-owned by later commits (dead/superseded)", async () => {
    const owners = new Map<number, string>();
    for (let l = 10; l <= 15; l++) owners.set(l, "later-commit");
    const judging = makeDeps({
      cursor: PREV,
      blameByFile: { "src/auth.ts": owners },
    });

    const result = await runL3ValidityPass(judging);

    expect(result.superseded).toBe(1);
    expect(judging.store.l3.updateValidityStatus).toHaveBeenCalledWith(
      1,
      "garbage",
    );
  });

  it("keeps the row alive when any line in the region still blames to it (partial edit)", async () => {
    const owners = new Map<number, string>();
    for (let l = 10; l <= 15; l++) owners.set(l, "later-commit");
    owners.set(12, PREV); // one original line survived
    const judging = makeDeps({
      cursor: PREV,
      blameByFile: { "src/auth.ts": owners },
    });

    const result = await runL3ValidityPass(judging);

    expect(result.activated).toBe(1);
  });

  it("skips rows whose anchored files were untouched since the cursor", async () => {
    const untouched = makeDeps({
      cursor: PREV,
      changedFiles: ["src/other.ts"],
    });
    const result = await runL3ValidityPass(untouched);

    expect(untouched.blame.getBlameLineOwners).not.toHaveBeenCalled();
    expect(result.activated + result.superseded).toBe(0);
  });

  it("never resurrects garbage rows, even when blame would call them alive", async () => {
    const resurrect = makeDeps({
      cursor: PREV,
      rows: [makeRow({ validity_status: "garbage" })],
    });
    await runL3ValidityPass(resurrect);

    expect(resurrect.store.l3.updateValidityStatus).not.toHaveBeenCalled();
  });

  it("skips rows without anchors (unknown region -- file-level fallback is out of scope)", async () => {
    const noAnchors = makeDeps({
      cursor: PREV,
      rows: [makeRow({ anchor_ranges: null })],
    });
    const result = await runL3ValidityPass(noAnchors);

    expect(noAnchors.blame.getBlameLineOwners).not.toHaveBeenCalled();
    expect(result.activated + result.superseded).toBe(0);
  });

  it("treats an unblameable file as surviving (unknown ownership is not evidence of death)", async () => {
    const unblameable = makeDeps({ cursor: PREV, blameByFile: {} });
    const result = await runL3ValidityPass(unblameable);

    expect(result.activated).toBe(1);
  });
});
