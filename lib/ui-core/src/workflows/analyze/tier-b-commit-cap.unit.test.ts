import { describe, it, expect, vi } from "vitest";
import type { IGitProvider } from "@workspace/contracts";
import { isTierBCommitCapExceeded } from "./tier-b-commit-cap.js";

function makeGit(ancestry: string[]): IGitProvider {
  return {
    getCommitAncestry: vi.fn().mockResolvedValue(ancestry),
  } as unknown as IGitProvider;
}

describe("isTierBCommitCapExceeded() (§8f, D5)", () => {
  it("is inactive (false) when lastTierBBatchSha is absent -- pre-Slice-3 workspace", async () => {
    const git = makeGit([]);
    const result = await isTierBCommitCapExceeded(
      git,
      "/workspace",
      undefined,
      20,
    );
    expect(result).toBe(false);
    expect(git.getCommitAncestry).not.toHaveBeenCalled();
  });

  it("is false when fewer than cap commits separate HEAD from the last batch sha", async () => {
    const ancestry = ["h5", "h4", "h3", "h2", "h1", "batch-sha"];
    const git = makeGit(ancestry);
    const result = await isTierBCommitCapExceeded(
      git,
      "/workspace",
      "batch-sha",
      20,
    );
    expect(result).toBe(false);
  });

  it("is true when exactly cap commits separate HEAD from the last batch sha", async () => {
    const ancestry = Array.from({ length: 20 }, (_, i) => `h${i}`).concat(
      "batch-sha",
    );
    const git = makeGit(ancestry);
    const result = await isTierBCommitCapExceeded(
      git,
      "/workspace",
      "batch-sha",
      20,
    );
    expect(result).toBe(true);
    expect(git.getCommitAncestry).toHaveBeenCalledWith(
      "/workspace",
      "HEAD",
      21,
    );
  });

  it("is true (safe fallback) when lastTierBBatchSha is not found within the probed depth", async () => {
    const ancestry = Array.from({ length: 21 }, (_, i) => `h${i}`);
    const git = makeGit(ancestry);
    const result = await isTierBCommitCapExceeded(
      git,
      "/workspace",
      "long-lost-sha",
      20,
    );
    expect(result).toBe(true);
  });

  it("uses the default cap (20) when none is given", async () => {
    const ancestry = Array.from({ length: 20 }, (_, i) => `h${i}`).concat(
      "batch-sha",
    );
    const git = makeGit(ancestry);
    const result = await isTierBCommitCapExceeded(
      git,
      "/workspace",
      "batch-sha",
    );
    expect(result).toBe(true);
  });
});
