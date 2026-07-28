import { describe, it, expect } from "vitest";
import { renderBanner, renderTable } from "../../../src/ui/table.js";

describe("renderBanner", () => {
  it("draws a box sized to the title with 1-space padding on each side", () => {
    const lines = renderBanner("Docuvia Doctor Diagnostics");

    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("│ Docuvia Doctor Diagnostics │");
    const dashes = "─".repeat("Docuvia Doctor Diagnostics".length + 2);
    expect(lines[0]).toBe(`┌${dashes}┐`);
    expect(lines[2]).toBe(`└${dashes}┘`);
    // Every line has the same visible width -- a real box, not a ragged one.
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });
});

/** Right-pads `text` to `width` with spaces -- an independent re-implementation used only to
 *  build expected strings, so these assertions don't just echo renderTable's own padding logic. */
function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

function expectedBorder(
  widths: number[],
  left: string,
  mid: string,
  right: string,
): string {
  return left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right;
}

function expectedRow(cells: string[], widths: number[]): string {
  const padded = cells.map((cell, i) => padEnd(cell, widths[i]));
  return `│ ${padded.join(" │ ")} │`;
}

describe("renderTable", () => {
  it("renders a header row, separator, data rows, and matching borders", () => {
    const columns = [{ header: "Check" }, { header: "Status" }];
    const rows = [
      ["db_found", "✓ PASS"],
      ["git_network", "✗ FAIL"],
    ];
    // Column widths independently derived from the same inputs (max of header/content length).
    const widths = [
      Math.max("Check".length, "db_found".length, "git_network".length),
      Math.max("Status".length, "✓ PASS".length, "✗ FAIL".length),
    ];

    const lines = renderTable(columns, rows);

    expect(lines).toEqual([
      expectedBorder(widths, "┌", "┬", "┐"),
      expectedRow(["Check", "Status"], widths),
      expectedBorder(widths, "├", "┼", "┤"),
      expectedRow(rows[0], widths),
      expectedRow(rows[1], widths),
      expectedBorder(widths, "└", "┴", "┘"),
    ]);
    // All rows (including borders) share one width -- confirms alignment held.
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });

  it("word-wraps a cell past maxWidth into multiple lines within the same row, blank-padding the other columns", () => {
    const lines = renderTable(
      [{ header: "Check" }, { header: "Message", maxWidth: 10 }],
      // Every word is <= 10 chars so the width budget below is never legitimately exceeded by
      // wrapCell's "an unbreakable word may overflow" fallback (covered separately below).
      [["llm_reachability", "Tier C LLM endpoint is not up right now"]],
    );

    // top border, header, separator, N wrapped data lines, bottom border.
    const dataLines = lines.slice(3, -1);
    expect(dataLines.length).toBeGreaterThan(1);
    expect(dataLines[0]).toContain("llm_reachability");
    // Continuation lines repeat the Check column as blank padding, not the id again.
    for (const line of dataLines.slice(1)) {
      expect(line).not.toContain("llm_reachability");
    }
    // No wrapped line exceeds the configured column budget.
    for (const line of dataLines) {
      const messageCell = line.split("│")[2]?.trim() ?? "";
      expect(messageCell.length).toBeLessThanOrEqual(10);
    }
    // Every rendered line (borders, header, wrapped rows) shares one total width.
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });

  it("lets a single word that itself exceeds maxWidth overflow rather than mangling it", () => {
    const lines = renderTable(
      [{ header: "Message", maxWidth: 10 }],
      [["https://example.com/very/long/unbreakable/path"]],
    );

    const dataLines = lines.slice(3, -1);
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain(
      "https://example.com/very/long/unbreakable/path",
    );
  });

  it("collapses embedded newlines instead of letting them break row alignment (real bug: multi-line git stderr in a DiagnosticResult message)", () => {
    const lines = renderTable(
      [{ header: "Check" }, { header: "Message" }],
      [
        [
          "git_reachability",
          "fatal: not a git repository\n\nPlease check the remote",
        ],
      ],
    );

    // No line in the whole rendered table may contain a raw newline -- every line must be exactly
    // one printed row of the grid, or the box-drawing borders below it misalign.
    for (const line of lines) {
      expect(line).not.toContain("\n");
    }
    expect(lines.join(" ")).toContain(
      "fatal: not a git repository Please check the remote",
    );
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });

  it("does not wrap short cells even under a generous maxWidth", () => {
    const lines = renderTable(
      [{ header: "Status", maxWidth: 20 }],
      [["✓ PASS"]],
    );

    // top border, header, separator, exactly one data row, bottom border.
    expect(lines).toHaveLength(5);
  });

  it("renders a header-only table when there are no rows", () => {
    const lines = renderTable([{ header: "Check" }, { header: "Status" }], []);

    // top border, header, separator, bottom border -- no data rows.
    expect(lines).toHaveLength(4);
  });
});
