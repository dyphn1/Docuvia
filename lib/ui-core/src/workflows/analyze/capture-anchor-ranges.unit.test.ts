import { describe, it, expect, vi } from "vitest";
import type { IGitProvider } from "@workspace/contracts";
import { captureAnchorRanges } from "./capture-anchor-ranges.js";

function makeGit(
  rangesByFile: Record<string, Array<{ startRow: number; endRow: number }>>,
): IGitProvider {
  return {
    getChangedLineRanges: vi
      .fn()
      .mockImplementation(
        (_cwd: string, _fromRef: string, _toRef: string, filePath: string) =>
          rangesByFile[filePath] ?? [],
      ),
  } as unknown as IGitProvider;
}

const SHA = "abc1234abc1234abc1234abc1234abc1234abc1234";

describe("captureAnchorRanges()", () => {
  it("maps each file's diff hunks to {path,startRow,endRow} anchors", async () => {
    const git = makeGit({
      "src/auth.ts": [
        { startRow: 9, endRow: 14 },
        { startRow: 40, endRow: 40 },
      ],
    });

    const anchors = await captureAnchorRanges({
      git,
      workspaceRoot: "/ws",
      commitSha: SHA,
      sourceFiles: ["src/auth.ts"],
    });

    expect(anchors).toEqual([
      { path: "src/auth.ts", startRow: 9, endRow: 14 },
      { path: "src/auth.ts", startRow: 40, endRow: 40 },
    ]);
    // Diff is parent..commit -- the hunk the *writing* commit introduced.
    expect(git.getChangedLineRanges).toHaveBeenCalledWith(
      "/ws",
      `${SHA}^`,
      SHA,
      "src/auth.ts",
    );
  });

  it("returns null when there is no commit to diff against (unknown region, not an empty confirmed one)", async () => {
    const anchors = await captureAnchorRanges({
      git: makeGit({}),
      workspaceRoot: "/ws",
      commitSha: null,
      sourceFiles: ["src/auth.ts"],
    });

    expect(anchors).toBeNull();
  });

  it("degrades a file git yields no hunks for to 'no anchor', keeping the other files' ranges", async () => {
    const anchors = await captureAnchorRanges({
      git: makeGit({ "src/a.ts": [{ startRow: 0, endRow: 3 }] }),
      workspaceRoot: "/ws",
      commitSha: SHA,
      sourceFiles: ["src/a.ts", "src/deleted-by-commit.ts"],
    });

    expect(anchors).toEqual([{ path: "src/a.ts", startRow: 0, endRow: 3 }]);
  });

  it("normalizes backslash paths to node_key form before asking git", async () => {
    const git = makeGit({ "src/win.ts": [{ startRow: 1, endRow: 2 }] });

    await captureAnchorRanges({
      git,
      workspaceRoot: "/ws",
      commitSha: SHA,
      sourceFiles: ["src\\win.ts"],
    });

    expect(git.getChangedLineRanges).toHaveBeenCalledWith(
      "/ws",
      `${SHA}^`,
      SHA,
      "src/win.ts",
    );
  });
});
