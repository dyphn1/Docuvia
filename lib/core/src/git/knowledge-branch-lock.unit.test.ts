import { describe, it, expect, vi } from "vitest";
import type { IGitProvider } from "@workspace/contracts";
import { withKnowledgeBranchLock } from "./knowledge-branch-lock.js";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    acquireKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    releaseKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IGitProvider;
}

describe("withKnowledgeBranchLock()", () => {
  it("acquires before running fn and releases after it resolves", async () => {
    const git = makeMockGitProvider();
    const order: string[] = [];
    (git.acquireKnowledgeLock as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        order.push("acquire");
      },
    );
    (git.releaseKnowledgeLock as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        order.push("release");
      },
    );

    const result = await withKnowledgeBranchLock(
      git,
      "/workspace",
      async () => {
        order.push("fn");
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(order).toEqual(["acquire", "fn", "release"]);
  });

  it("releases the lock even when fn throws", async () => {
    const git = makeMockGitProvider();

    await expect(
      withKnowledgeBranchLock(git, "/workspace", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(git.releaseKnowledgeLock).toHaveBeenCalledWith("/workspace");
  });

  it("does not run fn or release when acquiring the lock itself throws", async () => {
    const git = makeMockGitProvider({
      acquireKnowledgeLock: vi
        .fn()
        .mockRejectedValue(new Error("lock timeout")),
    });
    const fn = vi.fn();

    await expect(
      withKnowledgeBranchLock(git, "/workspace", fn),
    ).rejects.toThrow("lock timeout");

    expect(fn).not.toHaveBeenCalled();
    expect(git.releaseKnowledgeLock).not.toHaveBeenCalled();
  });
});
