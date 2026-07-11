import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { QueryService } from "./query-service.js";
import type { SqliteGraphRepository } from "./sqlite-graph.repository.js";

/**
 * Fake better-sqlite3 Database: query-service.ts's getContext()/getImpact() only ever call
 * `.prepare(sql).get(arg)` / `.prepare(sql).all(arg)` / `.close()`. Branching on the SQL text
 * lets one fake stand in for the three distinct prepared statements getContext() issues
 * (exact name lookup, LIKE fallback, incoming edges, outgoing edges) without needing a real
 * SQLite file on disk.
 */
interface FakeDbConfig {
  node?: { id: number; name: string; type: string };
  incoming?: Array<{ name: string; type: string }>;
  outgoing?: Array<{ target_name: string; target_type: string }>;
}

function makeFakeDb(config: FakeDbConfig) {
  return {
    prepare: (sql: string) => ({
      get: () => config.node,
      all: () => {
        if (sql.includes("l.target_node_id = ?")) {
          return (config.incoming ?? []).map((r) => ({ name: r.name, type: r.type }));
        }
        if (sql.includes("l.source_node_id = ?")) {
          return config.outgoing ?? [];
        }
        return [];
      },
    }),
    close: () => {},
  };
}

let fakeDbConfig: FakeDbConfig = {};

vi.mock("better-sqlite3", () => ({
  default: vi.fn().mockImplementation(() => makeFakeDb(fakeDbConfig)),
}));

describe("QueryService.query() — merged context (section 4)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-query-service-test-"));
    fs.mkdirSync(path.join(tmpDir, ".docuvia"), { recursive: true });
    // Content is irrelevant — better-sqlite3's Database constructor is mocked above, so this
    // file only needs to exist to satisfy assertDbExists()'s fs.existsSync() check.
    fs.writeFileSync(path.join(tmpDir, ".docuvia", "local.db"), "");
    fakeDbConfig = {};
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function makeService(searchResults: any[]) {
    const fakeGraphRepository = {
      searchLocalNodes: vi.fn().mockResolvedValue(searchResults),
    } as unknown as SqliteGraphRepository;
    return new QueryService(tmpDir, fakeGraphRepository);
  }

  it("includes context merged from getContext() alongside the existing l2/l3 fields", async () => {
    fakeDbConfig = {
      node: { id: 1, name: "helper", type: "function" },
      incoming: [{ name: "main", type: "function" }],
      outgoing: [{ target_name: "utilFn", target_type: "function" }],
    };
    const service = makeService([
      { nodeLayer: "l2", title: "helper", content: null },
      { nodeLayer: "l3", title: "Some decision", content: "decision body" },
    ]);

    const result = await service.query("helper", {});

    expect(result.l2).toEqual({ name: "helper", slug: "helper" });
    expect(result.l3).toEqual([{ title: "Some decision", content: "decision body" }]);
    expect(result.context).toEqual({
      incoming: [{ source_name: "main", source_type: "function" }],
      outgoing: [{ target_name: "utilFn", target_type: "function" }],
    });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "query.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.some((l) => l.event === "query.start" && l.target === "helper")).toBe(true);
    const summary = lines.find((l) => l.event === "query.summary");
    expect(summary).toBeDefined();
    expect(summary.found).toBe(true);
  });

  it("does not throw and returns context: null when getContext() finds no matching graph node", async () => {
    fakeDbConfig = { node: undefined };
    const service = makeService([]);

    const result = await service.query("nonexistent-symbol", {});

    expect(result.l2).toBeNull();
    expect(result.l3).toEqual([]);
    expect(result.context).toBeNull();

    const logPath = path.join(tmpDir, ".docuvia", "logs", "query.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const summary = lines.find((l) => l.event === "query.summary");
    expect(summary).toBeDefined();
    expect(summary.found).toBe(false);
  });
});
