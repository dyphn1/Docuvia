import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  DocuviaError,
  ErrorCodes,
  ANALYZE_LOG_FILE_NAME,
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  type ChatCompletionRequest,
  type IGitProvider,
  type IGraphStore,
  type ILlmClient,
} from "@workspace/contracts";
import { runTierCDrain, type TierCDrainDeps } from "./run-tier-c-drain.js";
import {
  appendTierCQueueEntries,
  readTierCQueue,
  TierCCandidateKinds,
} from "./tier-c-queue.js";
import { ANALYZE_MESSAGES } from "./analyze-messages.js";
import { writeTierCBudget } from "./tier-c-budget.js";
import { tryAcquireTierCLock } from "./tier-c-throttle.js";

const HEAD_SHA = "cafebabecafebabecafebabecafebabecafebabe";

function makeGit(overrides: Partial<IGitProvider> = {}): IGitProvider {
  return {
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IGitProvider;
}

interface FakeStore {
  meta: Map<string, string>;
  nodeKeyToId: Map<string, number>;
  upserted: unknown[];
}

function makeStore(nodeKeys: string[] = []): {
  store: IGraphStore;
  fake: FakeStore;
} {
  const fake: FakeStore = {
    meta: new Map(),
    nodeKeyToId: new Map(nodeKeys.map((k, i) => [k, i + 1])),
    upserted: [],
  };

  const store = {
    meta: {
      get: (key: string) => fake.meta.get(key),
      set: (key: string, value: string) => {
        fake.meta.set(key, value);
      },
    },
    projects: {
      getFirst: () => ({ id: 1 }),
    },
    graph: {
      findNodeIdByNodeKey: (key: string) => fake.nodeKeyToId.get(key),
    },
    l3: {
      upsertDecision: vi.fn((input: unknown) => {
        fake.upserted.push(input);
        return { id: fake.upserted.length, deduped: false };
      }),
    },
    withWriteLock: async (fn: () => unknown) => fn(),
    withTransaction: (fn: () => unknown) => fn(),
  } as unknown as IGraphStore;

  return { store, fake };
}

function makeLlmClient(
  content: string | (() => string),
): ILlmClient & { chatCompletion: ReturnType<typeof vi.fn> } {
  return {
    initialize: vi.fn(),
    chatCompletion: vi.fn().mockImplementation(async () => ({
      id: "chatcmpl-1",
      model: "test-model",
      choices: [
        {
          index: 0,
          finishReason: "stop",
          message: {
            role: "assistant",
            content: typeof content === "function" ? content() : content,
          },
        },
      ],
    })),
    streamChatCompletion: vi.fn(),
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    checkBridgeReachability: vi.fn().mockResolvedValue({ available: true }),
  };
}

function registerLlmClient(client: ILlmClient): void {
  docuviaFactory.register(TOKENS.LlmClient, () => () => client);
}

function baseDeps(overrides: Partial<TierCDrainDeps> = {}): TierCDrainDeps {
  return {
    workspaceRoot: overrides.workspaceRoot ?? "",
    logger: createMockLogger(),
    store: overrides.store ?? makeStore().store,
    git: overrides.git ?? makeGit(),
    llmBaseUrl: "http://localhost:8317",
    llmModel: "test-model",
    ...overrides,
  };
}

/** Reads and parses `.docuvia/logs/analyze.log`'s JSONL lines -- mirrors
 *  `run-delta-ingestion.unit.test.ts`'s own inline log-reading pattern. */
function readAnalyzeLogLines(
  workspaceRoot: string,
): Array<Record<string, unknown>> {
  const logPath = path.join(
    workspaceRoot,
    DOCUVIA_DIR_NAME,
    DOCUVIA_LOGS_DIR_NAME,
    ANALYZE_LOG_FILE_NAME,
  );
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("runTierCDrain() (§9)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-drain-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("no-ops on an empty queue without touching the LLM client", async () => {
    const { store } = makeStore();
    const builder = vi.fn();
    docuviaFactory.register(TOKENS.LlmClient, () => builder);

    const result = await runTierCDrain(baseDeps({ workspaceRoot, store }));

    expect(result.tierCQueued).toBe(0);
    expect(result.tierCSkipped).toBe(false);
    expect(builder).not.toHaveBeenCalled();
  });

  it("skips honestly when the LLM bridge is not configured, leaving the queue untouched", async () => {
    const { store } = makeStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive change",
      },
    ]);

    const result = await runTierCDrain(
      baseDeps({
        workspaceRoot,
        store,
        llmBaseUrl: undefined,
        llmModel: undefined,
      }),
    );

    expect(result.tierCSkipped).toBe(true);
    expect(result.tierCSkippedReason).toBe("llm-not-configured");
    expect(readTierCQueue(store)).toHaveLength(1);
  });

  it("skips honestly when the concurrency=1 lock is already held (gating test 3)", async () => {
    const { store } = makeStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive change",
      },
    ]);
    const heldLock = await tryAcquireTierCLock(workspaceRoot);
    expect(heldLock).toBeDefined();

    try {
      const result = await runTierCDrain(baseDeps({ workspaceRoot, store }));
      expect(result.tierCSkipped).toBe(true);
      expect(result.tierCSkippedReason).toBe("lock-contended");
      expect(readTierCQueue(store)).toHaveLength(1);
    } finally {
      await heldLock!.release();
    }
  });

  it("skips honestly when the daily budget is already exhausted (gating test 2)", async () => {
    const { store } = makeStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive change",
      },
    ]);
    writeTierCBudget(store, {
      date: new Date().toISOString().slice(0, 10),
      calls: 999,
      tokens: 0,
    });

    const result = await runTierCDrain(
      baseDeps({ workspaceRoot, store, dailyCallCap: 1 }),
    );

    expect(result.tierCSkipped).toBe(true);
    expect(result.tierCSkippedReason).toBe("budget-exhausted");
    expect(readTierCQueue(store)).toHaveLength(1);
  });
});

describe("runTierCDrain() -- persistence and honest degradation", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-drain-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("persists a commit-message candidate with full provenance and dequeues it on success", async () => {
    const { store, fake } = makeStore(["src/a.ts"]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive change",
      },
    ]);
    const git = makeGit({
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    registerLlmClient(
      makeLlmClient(
        JSON.stringify([
          {
            title: "Decision",
            nodeType: "decision",
            content: "Because reasons.",
            confidence: 0.8,
          },
        ]),
      ),
    );

    const result = await runTierCDrain(baseDeps({ workspaceRoot, store, git }));

    expect(result.tierCSkipped).toBe(false);
    expect(result.tierCProcessed).toBe(1);
    expect(result.tierCPersisted).toBe(1);
    expect(readTierCQueue(store)).toEqual([]);
    expect(fake.upserted).toEqual([
      expect.objectContaining({
        projectId: 1,
        l2NodeId: 1,
        commitSha: HEAD_SHA,
        extractionModel: "test-model",
        sourceFiles: ["src/a.ts"],
      }),
    ]);
  });

  it("persists a CONTRACT_CHANGED-symbol candidate, reading its file content via readFileAtRef", async () => {
    const { store, fake } = makeStore(["src/a.ts#foo"]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        target: "src/a.ts#foo",
        commitSha: HEAD_SHA,
        file: "src/a.ts",
      },
    ]);
    const git = makeGit({
      readFileAtRef: vi.fn().mockResolvedValue("export function foo() {}\n"),
    });
    const llmClient = makeLlmClient(
      JSON.stringify([
        {
          title: "Symbol decision",
          nodeType: "rule",
          content: "A rule.",
          confidence: 0.5,
        },
      ]),
    );
    registerLlmClient(llmClient);

    const result = await runTierCDrain(baseDeps({ workspaceRoot, store, git }));

    expect(result.tierCPersisted).toBe(1);
    expect(readTierCQueue(store)).toEqual([]);
    expect(fake.upserted).toEqual([
      expect.objectContaining({ l2NodeId: 1, sourceFiles: ["src/a.ts"] }),
    ]);
    const userMessage =
      llmClient.chatCompletion.mock.calls[0][0].messages[1].content;
    expect(userMessage).toContain("foo");
    expect(userMessage).toContain("export function foo() {}");
  });

  it("keeps a candidate queued when no L2 anchor resolves, without calling the LLM", async () => {
    const { store } = makeStore([]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive change",
      },
    ]);
    const git = makeGit({
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    const llmClient = makeLlmClient("[]");
    registerLlmClient(llmClient);

    const result = await runTierCDrain(baseDeps({ workspaceRoot, store, git }));

    expect(result.tierCFailed).toBe(1);
    expect(readTierCQueue(store)).toHaveLength(1);
    expect(llmClient.chatCompletion).not.toHaveBeenCalled();
  });

  it("honest degradation: a bridge-unreachable failure leaves the item queued, exits without throwing (gating test 5)", async () => {
    const { store } = makeStore(["src/a.ts"]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive change",
      },
    ]);
    const git = makeGit({
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    registerLlmClient({
      initialize: vi.fn(),
      chatCompletion: vi
        .fn()
        .mockRejectedValue(
          new DocuviaError(
            ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
            "connection refused",
          ),
        ),
      streamChatCompletion: vi.fn(),
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      checkBridgeReachability: vi.fn().mockResolvedValue({ available: true }),
    });

    const result = await runTierCDrain(baseDeps({ workspaceRoot, store, git }));

    expect(result.tierCFailed).toBe(1);
    expect(result.tierCPersisted).toBe(0);
    expect(readTierCQueue(store)).toHaveLength(1);
  });
});

describe("runTierCDrain() -- wall-clock cap and item cap (gating test 4)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-drain-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("stops after the wall-clock deadline, persisting completed items and re-queuing the remainder; a re-run converges", async () => {
    const { store } = makeStore(["src/a.ts", "src/b.ts"]);
    const entryA = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-a",
      commitSha: "sha-a",
      message: "feat: add the first substantive change",
    };
    const entryB = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-b",
      commitSha: "sha-b",
      message: "feat: add the second substantive change",
    };
    appendTierCQueueEntries(store, [entryA, entryB]);
    const git = makeGit({
      getFilesChangedByCommit: vi
        .fn()
        .mockImplementation(async (_root: string, sha: string) =>
          sha === "sha-a" ? ["src/a.ts"] : ["src/b.ts"],
        ),
    });
    registerLlmClient(
      makeLlmClient(
        JSON.stringify([
          {
            title: "Decision",
            nodeType: "decision",
            content: "Because reasons.",
            confidence: 0.8,
          },
        ]),
      ),
    );

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(500) // tryAcquireTierCLock's internal acquireProcessLock deadline calc
      .mockReturnValueOnce(1_000) // drainQueue's own deadline computation
      .mockReturnValueOnce(1_000) // entry A: before-deadline check
      .mockReturnValueOnce(50_000); // entry B: after-deadline check

    const result = await runTierCDrain(
      baseDeps({ workspaceRoot, store, git, wallClockMs: 10_000, itemCap: 10 }),
    );

    expect(result.tierCProcessed).toBe(1);
    expect(readTierCQueue(store)).toEqual([entryB]);

    nowSpy.mockRestore();

    const secondResult = await runTierCDrain(
      baseDeps({ workspaceRoot, store, git, wallClockMs: 10_000, itemCap: 10 }),
    );
    expect(secondResult.tierCProcessed).toBe(1);
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("stops after the configured item count, leaving the remainder queued", async () => {
    const { store } = makeStore(["src/a.ts", "src/b.ts"]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-a",
        commitSha: "sha-a",
        message: "feat: first substantive change",
      },
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-b",
        commitSha: "sha-b",
        message: "feat: second substantive change",
      },
    ]);
    const git = makeGit({
      getFilesChangedByCommit: vi
        .fn()
        .mockImplementation(async (_root: string, sha: string) =>
          sha === "sha-a" ? ["src/a.ts"] : ["src/b.ts"],
        ),
    });
    registerLlmClient(
      makeLlmClient(
        JSON.stringify([
          {
            title: "Decision",
            nodeType: "decision",
            content: "Because reasons.",
            confidence: 0.8,
          },
        ]),
      ),
    );

    const result = await runTierCDrain(
      baseDeps({ workspaceRoot, store, git, itemCap: 1, wallClockMs: 60_000 }),
    );

    expect(result.tierCProcessed).toBe(1);
    expect(readTierCQueue(store)).toHaveLength(1);
  });
});

describe("runTierCDrain() -- mid-run budget exhaustion (gating test 2, second clause)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-drain-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("stops mid-run once the daily call budget is exhausted by an earlier item, leaving the remainder queued and writing a midRun JSONL line", async () => {
    const { store } = makeStore(["src/a.ts", "src/b.ts"]);
    const entryA = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-a",
      commitSha: "sha-a",
      message: "feat: add the first substantive change",
    };
    const entryB = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-b",
      commitSha: "sha-b",
      message: "feat: add the second substantive change",
    };
    appendTierCQueueEntries(store, [entryA, entryB]);
    const git = makeGit({
      getFilesChangedByCommit: vi
        .fn()
        .mockImplementation(async (_root: string, sha: string) =>
          sha === "sha-a" ? ["src/a.ts"] : ["src/b.ts"],
        ),
    });
    registerLlmClient(
      makeLlmClient(
        JSON.stringify([
          {
            title: "Decision",
            nodeType: "decision",
            content: "Because reasons.",
            confidence: 0.8,
          },
        ]),
      ),
    );

    // dailyCallCap: 1 -- item A's single LLM call exhausts the whole daily call budget, so item
    // B's pre-item budget re-check (drainQueue's loop, §9k gating test 2) must stop the loop
    // before B is ever attempted, distinct from the pre-dispatch "already exhausted" skip path
    // (already covered by the "skips honestly when the daily budget is already exhausted" test).
    const result = await runTierCDrain(
      baseDeps({
        workspaceRoot,
        store,
        git,
        dailyCallCap: 1,
        wallClockMs: 60_000,
        itemCap: 10,
      }),
    );

    expect(result.tierCSkipped).toBe(false);
    expect(result.tierCProcessed).toBe(1);
    expect(result.tierCFailed).toBe(0);
    expect(readTierCQueue(store)).toEqual([entryB]);

    const lines = readAnalyzeLogLines(workspaceRoot);
    const midRunLine = lines.find(
      (l) => l.event === "analyze.tierC.skipped" && l.midRun === true,
    );
    expect(midRunLine).toBeDefined();
    expect(midRunLine?.reason).toBe("budget-exhausted");
    expect(midRunLine?.queued).toBe(2);
  });
});

describe("runTierCDrain() -- system-load-high skip path (gating test 5, third named trigger)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-drain-test-"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("skips the whole drain honestly when the system-load check trips, leaving the queue untouched and never calling the LLM", async () => {
    const { store } = makeStore(["src/a.ts"]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive change",
      },
    ]);
    const git = makeGit({
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    const llmClient = makeLlmClient("[]");
    registerLlmClient(llmClient);

    // Same os.loadavg()/os.cpus() spy pattern tier-c-throttle.unit.test.ts uses to force
    // checkTierCSystemLoad() to trip -- proves the check's wiring into runTierCDrain()'s
    // honest-degradation skip, not just the check function in isolation.
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.spyOn(os, "loadavg").mockReturnValue([8, 8, 8]);
    vi.spyOn(os, "cpus").mockReturnValue(Array(4).fill({}) as os.CpuInfo[]);

    const result = await runTierCDrain(
      baseDeps({ workspaceRoot, store, git, loadThreshold: 0.8 }),
    );

    expect(result.tierCSkipped).toBe(true);
    expect(result.tierCSkippedReason).toBe("load-high");
    expect(readTierCQueue(store)).toHaveLength(1);
    expect(llmClient.chatCompletion).not.toHaveBeenCalled();

    const lines = readAnalyzeLogLines(workspaceRoot);
    expect(
      lines.some(
        (l) => l.event === "analyze.tierC.skipped" && l.reason === "load-high",
      ),
    ).toBe(true);
  });
});

describe("runTierCDrain() -- poison-pill eviction of a permanently-failing head-of-line item", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-drain-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("evicts a bridge-unreachable head-of-line item after 3 runs, then makes forward progress on the next entry", async () => {
    const { store } = makeStore(["src/a.ts", "src/b.ts"]);
    const entryA = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-a",
      commitSha: "sha-a",
      message: "feat: always fails, always the same reason",
    };
    const entryB = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-b",
      commitSha: "sha-b",
      message: "feat: should eventually be reached and processed",
    };
    appendTierCQueueEntries(store, [entryA, entryB]);
    const git = makeGit({
      getFilesChangedByCommit: vi
        .fn()
        .mockImplementation(async (_root: string, sha: string) =>
          sha === "sha-a" ? ["src/a.ts"] : ["src/b.ts"],
        ),
    });
    registerLlmClient({
      initialize: vi.fn(),
      chatCompletion: vi
        .fn()
        .mockImplementation(async (req: ChatCompletionRequest) => {
          const userMessage = req.messages[1].content ?? "";
          if (userMessage.includes(entryA.message)) {
            throw new DocuviaError(
              ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
              "connection refused",
            );
          }
          return {
            id: "chatcmpl-1",
            model: "test-model",
            choices: [
              {
                index: 0,
                finishReason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify([
                    {
                      title: "Decision",
                      nodeType: "decision",
                      content: "Because reasons.",
                      confidence: 0.8,
                    },
                  ]),
                },
              },
            ],
          };
        }),
      streamChatCompletion: vi.fn(),
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      checkBridgeReachability: vi.fn().mockResolvedValue({ available: true }),
    });

    const runDeps = () =>
      baseDeps({ workspaceRoot, store, git, logger: createMockLogger() });

    // Run 1 (issue #145): entry A fails (bridge-unreachable), but the loop now CONTINUES
    // to entry B which is processed successfully. failCount for entry A is 1.
    const run1Deps = runDeps();
    const result1 = await runTierCDrain(run1Deps);
    expect(result1.tierCFailed).toBe(1);
    expect(result1.tierCProcessed).toBe(1);
    expect(readTierCQueue(store)).toEqual([{ ...entryA, failCount: 1 }]);

    // Run 2: same failure for entry A, failCount now 2, still below the default cap of 3.
    appendTierCQueueEntries(store, [entryB]); // re-queue entry B for this run
    const run2Deps = runDeps();
    const result2 = await runTierCDrain(run2Deps);
    expect(result2.tierCFailed).toBe(1);
    expect(readTierCQueue(store)).toEqual([{ ...entryA, failCount: 2 }]);

    // Run 3: failCount reaches 3 (the default DEFAULT_TIER_C_MAX_ITEM_FAILURES) -- entry A is
    // evicted, logged both to the console logger and the JSONL log. The loop continues and
    // processes entry B successfully.
    appendTierCQueueEntries(store, [entryB]); // re-queue entry B for this run
    const run3Logger = createMockLogger();
    const run3Deps = baseDeps({
      workspaceRoot,
      store,
      git,
      logger: run3Logger,
    });
    const result3 = await runTierCDrain(run3Deps);
    expect(result3.tierCFailed).toBe(1);
    expect(result3.tierCProcessed).toBe(1);
    expect(readTierCQueue(store)).toEqual([]);
    expect(
      run3Logger.events.some(
        (e) =>
          e.message ===
          ANALYZE_MESSAGES.TIER_C_ITEM_EVICTED(entryA.kind, entryA.target, 3),
      ),
    ).toBe(true);
    const run3Lines = readAnalyzeLogLines(workspaceRoot);
    expect(
      run3Lines.some(
        (l) =>
          l.event === "analyze.tierC.item_evicted" &&
          l.target === entryA.target &&
          l.failCount === 3,
      ),
    ).toBe(true);
  });

  it("bridge-unreachable on item A does not prevent item B from being processed (issue #145)", async () => {
    const { store } = makeStore(["src/a.ts", "src/b.ts"]);
    const entryA = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-a",
      commitSha: "sha-a",
      message: "feat: always fails with bridge-unreachable",
    };
    const entryB = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha-b",
      commitSha: "sha-b",
      message: "feat: should be processed after entry A fails",
    };
    appendTierCQueueEntries(store, [entryA, entryB]);
    const git = makeGit({
      getFilesChangedByCommit: vi
        .fn()
        .mockImplementation(async (_root: string, sha: string) =>
          sha === "sha-a" ? ["src/a.ts"] : ["src/b.ts"],
        ),
    });
    registerLlmClient({
      initialize: vi.fn(),
      chatCompletion: vi
        .fn()
        .mockImplementation(async (req: ChatCompletionRequest) => {
          const userMessage = req.messages[1].content ?? "";
          if (userMessage.includes(entryA.message)) {
            throw new DocuviaError(
              ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
              "connection refused",
            );
          }
          return {
            id: "chatcmpl-1",
            model: "test-model",
            choices: [
              {
                index: 0,
                finishReason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify([
                    {
                      title: "Decision",
                      nodeType: "decision",
                      content: "Because reasons.",
                      confidence: 0.8,
                    },
                  ]),
                },
              },
            ],
          };
        }),
      streamChatCompletion: vi.fn(),
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      checkBridgeReachability: vi.fn().mockResolvedValue({ available: true }),
    });

    const logger = createMockLogger();
    const result = await runTierCDrain(
      baseDeps({ workspaceRoot, store, git, logger }),
    );

    // Entry A failed (bridge-unreachable), but the loop continued to entry B
    expect(result.tierCFailed).toBe(1);
    expect(result.tierCProcessed).toBe(1);
    expect(result.tierCPersisted).toBe(1);

    // Entry A is still queued (will be evicted after 3 failures)
    // Entry B was processed and dequeued
    const remainingQueue = readTierCQueue(store);
    expect(remainingQueue).toHaveLength(1);
    expect(remainingQueue[0].target).toBe("sha-a");
    expect(remainingQueue[0].failCount).toBe(1);

    // Verify the eviction log message is NOT present (only 1 failure, not 3)
    expect(
      logger.events.some((e) =>
        e.message.includes(
          ANALYZE_MESSAGES.TIER_C_ITEM_EVICTED(entryA.kind, entryA.target, 1),
        ),
      ),
    ).toBe(false);
  });
});

describe("runTierCDrain() -- drainAll (issue #145: --tier-c-all)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-drain-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("drains all items when drainAll is true, ignoring wallClockMs and itemCap", async () => {
    const { store } = makeStore(["src/a.ts", "src/b.ts", "src/c.ts"]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-a",
        commitSha: "sha-a",
        message: "feat: first substantive change",
      },
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-b",
        commitSha: "sha-b",
        message: "feat: second substantive change",
      },
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-c",
        commitSha: "sha-c",
        message: "feat: third substantive change",
      },
    ]);
    const git = makeGit({
      getFilesChangedByCommit: vi
        .fn()
        .mockImplementation(async (_root: string, sha: string) => {
          const map: Record<string, string[]> = {
            "sha-a": ["src/a.ts"],
            "sha-b": ["src/b.ts"],
            "sha-c": ["src/c.ts"],
          };
          return map[sha] ?? [];
        }),
    });
    registerLlmClient(
      makeLlmClient(
        JSON.stringify([
          {
            title: "Decision",
            nodeType: "decision",
            content: "Because reasons.",
            confidence: 0.8,
          },
        ]),
      ),
    );

    // itemCap=1 and wallClockMs=1 -- these would normally stop after 1 item / 1ms,
    // but drainAll overrides both to Infinity.
    const result = await runTierCDrain(
      baseDeps({
        workspaceRoot,
        store,
        git,
        itemCap: 1,
        wallClockMs: 1,
        drainAll: true,
      }),
    );

    expect(result.tierCSkipped).toBe(false);
    expect(result.tierCProcessed).toBe(3);
    expect(result.tierCPersisted).toBe(3);
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("still respects budget exhaustion even with drainAll", async () => {
    const { store } = makeStore(["src/a.ts", "src/b.ts"]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-a",
        commitSha: "sha-a",
        message: "feat: first substantive change",
      },
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-b",
        commitSha: "sha-b",
        message: "feat: second substantive change",
      },
    ]);
    const git = makeGit({
      getFilesChangedByCommit: vi
        .fn()
        .mockImplementation(async (_root: string, sha: string) =>
          sha === "sha-a" ? ["src/a.ts"] : ["src/b.ts"],
        ),
    });
    registerLlmClient(
      makeLlmClient(
        JSON.stringify([
          {
            title: "Decision",
            nodeType: "decision",
            content: "Because reasons.",
            confidence: 0.8,
          },
        ]),
      ),
    );

    // dailyCallCap=1 -- item A exhausts the budget, so item B must be left queued
    // even though drainAll removes wall-clock and item caps.
    const result = await runTierCDrain(
      baseDeps({
        workspaceRoot,
        store,
        git,
        dailyCallCap: 1,
        drainAll: true,
      }),
    );

    expect(result.tierCSkipped).toBe(false);
    expect(result.tierCProcessed).toBe(1);
    expect(readTierCQueue(store)).toEqual([
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha-b",
        commitSha: "sha-b",
        message: "feat: second substantive change",
      },
    ]);
  });
});
