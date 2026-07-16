import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { resolveAnchorL2NodeId, toNodeKey } from "./anchor-resolution.js";
import type { CollectedFile } from "./decision-extraction.js";

function makeStoreWithNodeKeys(nodeKeys: Record<string, number>): IGraphStore {
  return {
    graph: {
      findNodeIdByNodeKey: vi.fn((nodeKey: string) => nodeKeys[nodeKey]),
    },
  } as unknown as IGraphStore;
}

describe("toNodeKey()", () => {
  it("normalizes backslash-joined Windows-style relative paths to forward slashes", () => {
    expect(toNodeKey("src\\a.ts")).toBe("src/a.ts");
  });

  it("leaves already-forward-slash paths unchanged", () => {
    expect(toNodeKey("src/a.ts")).toBe("src/a.ts");
  });
});

describe("resolveAnchorL2NodeId()", () => {
  it("resolves via exact node_key match on the workspace-relative target path (file target)", () => {
    const store = makeStoreWithNodeKeys({ "src/a.ts": 42 });
    const files: CollectedFile[] = [{ relativePath: "src/a.ts", content: "" }];

    const result = resolveAnchorL2NodeId(
      store,
      "/workspace",
      "/workspace/src/a.ts",
      files,
    );

    expect(result).toBe(42);
  });

  it("falls back to the first collected source file's L2 node for a directory target with no exact node_key match", () => {
    const store = makeStoreWithNodeKeys({ "src/b.ts": 7 });
    const files: CollectedFile[] = [
      { relativePath: "src/a.ts", content: "" }, // not in the graph
      { relativePath: "src/b.ts", content: "" }, // resolves
    ];

    const result = resolveAnchorL2NodeId(
      store,
      "/workspace",
      "/workspace/src",
      files,
    );

    expect(result).toBe(7);
  });

  it("skips files with no L2 node and uses the first one that does resolve", () => {
    const store = makeStoreWithNodeKeys({ "src/c.ts": 99 });
    const files: CollectedFile[] = [
      { relativePath: "src/a.ts", content: "" },
      { relativePath: "src/b.ts", content: "" },
      { relativePath: "src/c.ts", content: "" },
    ];

    const result = resolveAnchorL2NodeId(
      store,
      "/workspace",
      "/workspace/src",
      files,
    );

    expect(result).toBe(99);
  });

  it("returns undefined when neither the target nor any collected file has an L2 node (empty/not-yet-ingested graph)", () => {
    const store = makeStoreWithNodeKeys({});
    const files: CollectedFile[] = [{ relativePath: "src/a.ts", content: "" }];

    const result = resolveAnchorL2NodeId(
      store,
      "/workspace",
      "/workspace/src",
      files,
    );

    expect(result).toBeUndefined();
  });
});
