import { describe, it, expect, vi } from "vitest";
import type { IGitProvider, IGraphStore } from "@workspace/contracts";
import { importL3CardsFromKnowledgeBranch } from "./l3-import.service.js";
import { renderL3Card } from "./l3-card-renderer.js";
import type { L3NodeRow } from "@workspace/contracts";

const NODES_JSONL =
  '{"id":"src/a.ts","type":"file","name":"src/a.ts","filePath":"src/a.ts"}\n';
const EDGES_JSONL = "";

function makeL3Row(overrides: Partial<L3NodeRow> = {}): L3NodeRow {
  return {
    id: 1,
    l2_node_id: 1,
    title: "A teammate's decision",
    content: "Decision content.",
    node_type: "decision",
    source_commits: JSON.stringify(["commit-1"]),
    commit_hash: "commit-1",
    ai_generated: 1,
    confidence: 0.9,
    noise_score: null,
    created_at: "2024-01-01T00:00:00.000Z",
    last_verified_at: null,
    occurrence_count: 1,
    introduced_in_commit: null,
    verified_until_commit: null,
    validity_status: "pending",
    source: "analyze",
    content_hash: "card-hash",
    extraction_model: "gpt-4o-mini",
    source_files: JSON.stringify(["src/a.ts"]),
    initial_source_commits: JSON.stringify(["commit-1"]),
    anchor_ranges: null,
    ...overrides,
  };
}

function makeGitProvider(overrides: Partial<IGitProvider> = {}): IGitProvider {
  return {
    listFilesAtRef: vi.fn().mockResolvedValue([]),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IGitProvider;
}

function makeStore(
  overrides: {
    findNodeIdByNodeKey?: ReturnType<typeof vi.fn>;
    importCard?: ReturnType<typeof vi.fn>;
  } = {},
): IGraphStore {
  return {
    graph: {
      findNodeIdByNodeKey:
        overrides.findNodeIdByNodeKey ?? vi.fn().mockReturnValue(42),
    },
    l3: {
      importCard:
        overrides.importCard ??
        vi.fn().mockReturnValue({ id: 1, imported: true }),
    },
  } as unknown as IGraphStore;
}

describe("importL3CardsFromKnowledgeBranch", () => {
  it("returns {cardsFound: 0, imported: 0} without reading graph/*.jsonl when knowledge/_l3 has no cards", async () => {
    const git = makeGitProvider({
      listFilesAtRef: vi.fn().mockResolvedValue([]),
    });
    const store = makeStore();

    const result = await importL3CardsFromKnowledgeBranch(
      git,
      "/repo",
      "sha1",
      store,
    );

    expect(result).toEqual({ cardsFound: 0, imported: 0 });
    expect(git.readFileAtRef).not.toHaveBeenCalled();
  });

  it("lists knowledge/_l3, resolves each card's l2_path to a local l2_node_id via nodeKey, and calls store.l3.importCard", async () => {
    const cardRaw = renderL3Card(makeL3Row(), "knowledge/src/a.ts.md");
    const findNodeIdByNodeKey = vi.fn().mockReturnValue(42);
    const importCard = vi.fn().mockReturnValue({ id: 7, imported: true });

    const git = makeGitProvider({
      listFilesAtRef: vi.fn().mockResolvedValue(["knowledge/_l3/card-hash.md"]),
      readFileAtRef: vi.fn().mockImplementation((_cwd, _ref, filePath) => {
        if (filePath === "graph/nodes.jsonl")
          return Promise.resolve(NODES_JSONL);
        if (filePath === "graph/edges.jsonl")
          return Promise.resolve(EDGES_JSONL);
        if (filePath === "knowledge/_l3/card-hash.md")
          return Promise.resolve(cardRaw);
        return Promise.resolve(undefined);
      }),
    });
    const store = makeStore({ findNodeIdByNodeKey, importCard });

    const result = await importL3CardsFromKnowledgeBranch(
      git,
      "/repo",
      "sha1",
      store,
    );

    expect(findNodeIdByNodeKey).toHaveBeenCalledWith("src/a.ts");
    expect(importCard).toHaveBeenCalledWith(
      expect.objectContaining({
        l2NodeId: 42,
        contentHash: "card-hash",
        title: "A teammate's decision",
        content: "Decision content.",
        nodeType: "decision",
        sourceCommits: ["commit-1"],
        extractionModel: "gpt-4o-mini",
        sourceFiles: ["src/a.ts"],
        createdAt: "2024-01-01T00:00:00.000Z",
      }),
    );
    expect(result).toEqual({ cardsFound: 1, imported: 1 });
  });

  it("skips a card whose l2_path doesn't resolve to any known node (the L2 node doesn't exist locally yet)", async () => {
    const cardRaw = renderL3Card(
      makeL3Row(),
      "knowledge/src/does-not-exist.ts.md",
    );
    const importCard = vi.fn();
    const git = makeGitProvider({
      listFilesAtRef: vi.fn().mockResolvedValue(["knowledge/_l3/card-hash.md"]),
      readFileAtRef: vi.fn().mockImplementation((_cwd, _ref, filePath) => {
        if (filePath === "graph/nodes.jsonl")
          return Promise.resolve(NODES_JSONL);
        if (filePath === "graph/edges.jsonl")
          return Promise.resolve(EDGES_JSONL);
        if (filePath === "knowledge/_l3/card-hash.md")
          return Promise.resolve(cardRaw);
        return Promise.resolve(undefined);
      }),
    });
    const store = makeStore({ importCard });

    const result = await importL3CardsFromKnowledgeBranch(
      git,
      "/repo",
      "sha1",
      store,
    );

    expect(importCard).not.toHaveBeenCalled();
    expect(result).toEqual({ cardsFound: 1, imported: 0 });
  });

  it("skips a card whose resolved nodeKey has no matching local l2_node_id yet", async () => {
    const cardRaw = renderL3Card(makeL3Row(), "knowledge/src/a.ts.md");
    const importCard = vi.fn();
    const git = makeGitProvider({
      listFilesAtRef: vi.fn().mockResolvedValue(["knowledge/_l3/card-hash.md"]),
      readFileAtRef: vi.fn().mockImplementation((_cwd, _ref, filePath) => {
        if (filePath === "graph/nodes.jsonl")
          return Promise.resolve(NODES_JSONL);
        if (filePath === "graph/edges.jsonl")
          return Promise.resolve(EDGES_JSONL);
        if (filePath === "knowledge/_l3/card-hash.md")
          return Promise.resolve(cardRaw);
        return Promise.resolve(undefined);
      }),
    });
    const store = makeStore({
      findNodeIdByNodeKey: vi.fn().mockReturnValue(undefined),
      importCard,
    });

    const result = await importL3CardsFromKnowledgeBranch(
      git,
      "/repo",
      "sha1",
      store,
    );

    expect(importCard).not.toHaveBeenCalled();
    expect(result).toEqual({ cardsFound: 1, imported: 0 });
  });

  it("skips a card that fails to parse (malformed content), without throwing", async () => {
    const importCard = vi.fn();
    const git = makeGitProvider({
      listFilesAtRef: vi.fn().mockResolvedValue(["knowledge/_l3/garbage.md"]),
      readFileAtRef: vi.fn().mockImplementation((_cwd, _ref, filePath) => {
        if (filePath === "graph/nodes.jsonl")
          return Promise.resolve(NODES_JSONL);
        if (filePath === "graph/edges.jsonl")
          return Promise.resolve(EDGES_JSONL);
        if (filePath === "knowledge/_l3/garbage.md")
          return Promise.resolve("not a card");
        return Promise.resolve(undefined);
      }),
    });
    const store = makeStore({ importCard });

    const result = await importL3CardsFromKnowledgeBranch(
      git,
      "/repo",
      "sha1",
      store,
    );

    expect(importCard).not.toHaveBeenCalled();
    expect(result).toEqual({ cardsFound: 1, imported: 0 });
  });
});
