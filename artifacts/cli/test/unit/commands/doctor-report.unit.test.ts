import { describe, it, expect } from "vitest";
import {
  buildDiagnosticRow,
  categorizeDiagnosticKey,
  DOCTOR_CATEGORY_ORDER,
  groupDiagnosticsByCategory,
  summarizeDiagnostics,
} from "../../../src/commands/doctor-report.js";
import { UI_MESSAGES } from "../../../src/constants/ui-messages.js";

describe("categorizeDiagnosticKey", () => {
  it.each([
    ["sqlite_integrity", UI_MESSAGES.DOCTOR_CATEGORY_DATABASE],
    ["sqlite_wal_bloat", UI_MESSAGES.DOCTOR_CATEGORY_DATABASE],
    ["db_found", UI_MESSAGES.DOCTOR_CATEGORY_DATABASE],
    ["db_runner", UI_MESSAGES.DOCTOR_CATEGORY_DATABASE],
    ["git_hook", UI_MESSAGES.DOCTOR_CATEGORY_GIT_HOOKS],
    ["pre_push_hook", UI_MESSAGES.DOCTOR_CATEGORY_GIT_HOOKS],
    ["git_network", UI_MESSAGES.DOCTOR_CATEGORY_GIT],
    ["git_reachability", UI_MESSAGES.DOCTOR_CATEGORY_GIT],
    ["git_runner", UI_MESSAGES.DOCTOR_CATEGORY_GIT],
    ["logs", UI_MESSAGES.DOCTOR_CATEGORY_LOGS],
    ["tier_b_commit_cap", UI_MESSAGES.DOCTOR_CATEGORY_TIER_B],
    ["llm_reachability", UI_MESSAGES.DOCTOR_CATEGORY_LLM],
    ["lsp_binary_typescript", UI_MESSAGES.DOCTOR_CATEGORY_LSP],
    ["agent_hooks_claude", UI_MESSAGES.DOCTOR_CATEGORY_AGENT_HOOKS],
    ["agent_hooks_cursor", UI_MESSAGES.DOCTOR_CATEGORY_AGENT_HOOKS],
    ["some_future_check", UI_MESSAGES.DOCTOR_CATEGORY_OTHER],
  ])("categorizes %s as %s", (key, expected) => {
    expect(categorizeDiagnosticKey(key)).toBe(expected);
  });

  it("routes git_hook/pre_push_hook to Git Hooks, not the generic git_ prefix bucket", () => {
    // git_hook starts with "git_" too -- the exact-match rule must win over the prefix rule.
    expect(categorizeDiagnosticKey("git_hook")).not.toBe(
      UI_MESSAGES.DOCTOR_CATEGORY_GIT,
    );
  });
});

describe("groupDiagnosticsByCategory", () => {
  it("buckets diagnostics by category and preserves insertion order within a bucket", () => {
    const groups = groupDiagnosticsByCategory({
      sqlite_connection: { status: "pass", message: "a" },
      git_network: { status: "pass", message: "b" },
      sqlite_integrity: { status: "fail", message: "c" },
    });

    expect(
      groups.get(UI_MESSAGES.DOCTOR_CATEGORY_DATABASE)?.map(([k]) => k),
    ).toEqual(["sqlite_connection", "sqlite_integrity"]);
    expect(
      groups.get(UI_MESSAGES.DOCTOR_CATEGORY_GIT)?.map(([k]) => k),
    ).toEqual(["git_network"]);
  });

  it("returns an empty map for an empty diagnostics record", () => {
    expect(groupDiagnosticsByCategory({}).size).toBe(0);
  });
});

describe("DOCTOR_CATEGORY_ORDER", () => {
  it("ends with the catch-all Other bucket", () => {
    expect(DOCTOR_CATEGORY_ORDER.at(-1)).toBe(
      UI_MESSAGES.DOCTOR_CATEGORY_OTHER,
    );
  });

  it("lists every category exactly once", () => {
    expect(new Set(DOCTOR_CATEGORY_ORDER).size).toBe(
      DOCTOR_CATEGORY_ORDER.length,
    );
  });
});

describe("buildDiagnosticRow", () => {
  it("renders a PASS row with an empty Suggested Fix cell", () => {
    const row = buildDiagnosticRow("sqlite_integrity", {
      status: "pass",
      message: "Database integrity check passed",
    });

    expect(row).toEqual([
      "sqlite_integrity",
      "✓ PASS",
      "Database integrity check passed",
      "",
    ]);
  });

  it("renders a FAIL row with its suggestion in the Fix cell", () => {
    const row = buildDiagnosticRow("git_network", {
      status: "fail",
      message: "Git remote reachability check failed",
      suggestion: "Check your internet connection",
    });

    expect(row).toEqual([
      "git_network",
      "✗ FAIL",
      "Git remote reachability check failed",
      "Check your internet connection",
    ]);
  });

  it("folds details into the Message cell as a parenthetical suffix", () => {
    const row = buildDiagnosticRow("sqlite_wal_bloat", {
      status: "fail",
      message: "WAL file is too large (>100MB)",
      details: "Size: 142.30 MB",
      suggestion: "Run docuvia clean and re-initialize",
    });

    expect(row[2]).toBe("WAL file is too large (>100MB) (Size: 142.30 MB)");
  });
});

describe("summarizeDiagnostics", () => {
  it("counts passed vs. total", () => {
    expect(
      summarizeDiagnostics({
        a: { status: "pass", message: "" },
        b: { status: "fail", message: "" },
        c: { status: "pass", message: "" },
      }),
    ).toEqual({ passed: 2, total: 3 });
  });

  it("returns 0/0 for no diagnostics", () => {
    expect(summarizeDiagnostics({})).toEqual({ passed: 0, total: 0 });
  });
});
