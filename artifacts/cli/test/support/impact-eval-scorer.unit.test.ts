import { describe, it, expect } from "vitest";
import {
  aggregateCases,
  buildCsv,
  buildMarkdownSummary,
  errorCase,
  scoreCase,
} from "./impact-eval-scorer.js";

describe("scoreCase()", () => {
  it("computes perfect precision/recall when predicted equals actual", () => {
    const result = scoreCase(
      "control-static-call",
      "evalAdd",
      ["src/a.ts"],
      ["src/a.ts"],
    );

    expect(result).toMatchObject({
      status: "ok",
      tp: 1,
      fp: 0,
      fn: 0,
      precision: 1,
      recall: 1,
      f1: 1,
    });
  });

  it("scores an empty prediction as a real recall failure (zero, never NaN)", () => {
    const result = scoreCase(
      "runtime-variable-import",
      "runCleanupPlugin",
      [],
      ["src/plugin-loader.ts"],
    );

    expect(result).toMatchObject({
      tp: 0,
      fp: 0,
      fn: 1,
      precision: 0,
      recall: 0,
    });
    expect(Number.isNaN(result.f1)).toBe(false);
    expect(result.f1).toBe(0);
  });

  it("penalizes over-prediction via precision while keeping recall honest", () => {
    const result = scoreCase(
      "re-export-chain",
      "evalChainHelper",
      ["src/app-main.ts", "src/extra.ts"],
      ["src/app-main.ts"],
    );

    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1);
    expect(result.precision).toBeCloseTo(0.5);
    expect(result.recall).toBe(1);
    expect(result.f1).toBeCloseTo(2 / 3);
  });

  it("deduplicates repeated predictions at file granularity", () => {
    const result = scoreCase("x", "t", ["src/a.ts", "src/a.ts"], ["src/a.ts"]);

    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
  });
});

describe("errorCase() + aggregateCases() -- failures can't masquerade as wins", () => {
  it("keeps error rows in results but excludes them from every aggregate mean", () => {
    const ok = scoreCase("s", "t1", [], []);
    const err = errorCase("s", "t2", ["src/x.ts"]);

    expect(err.status).toBe("error");

    const agg = aggregateCases([ok, err]);
    expect(agg.casesScored).toBe(1);
    expect(agg.casesErrored).toBe(1);
    // ok row is all-zeros -> means are exactly those zeros, not polluted by the error row.
    expect(agg.meanPrecision).toBe(0);
    expect(agg.meanRecall).toBe(0);
    expect(agg.meanF1).toBe(0);
  });

  it("returns null means when every case errored -- no number is better than a fake one", () => {
    const agg = aggregateCases([errorCase("s", "t", [])]);

    expect(agg.casesScored).toBe(0);
    expect(agg.meanF1).toBeNull();
  });
});

describe("report rendering", () => {
  it("buildCsv emits a header plus one row per case with quoted file lists", () => {
    const csv = buildCsv([
      scoreCase(
        "control-static-call",
        "evalAdd",
        ["src/calculator.ts"],
        ["src/calculator.ts"],
      ),
    ]);

    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("scenario,target,status,predicted_files");
    expect(lines[1]).toContain('"src/calculator.ts"');
    expect(lines[1]).toContain(",1.000,");
  });

  it("buildMarkdownSummary embeds the report-only caveat next to the aggregate", () => {
    const md = buildMarkdownSummary(
      [scoreCase("s", "t", [], ["src/a.ts"])],
      aggregateCases([scoreCase("s", "t", [], ["src/a.ts"])]),
    );

    expect(md).toContain("Impact accuracy eval (#192)");
    expect(md).toContain("Report-only baseline");
    expect(md).toContain("| s | `t` |");
  });
});
