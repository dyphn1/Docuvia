import { BOX_CHARS } from "../constants/box-drawing.js";

const LAYOUT = {
  SPACE: " ",
  EMPTY: "",
} as const;

export interface TableColumn {
  header: string;
  /** Wrap cell text past this width instead of growing the column further. Omit for
   *  columns whose content is always short (ids, status labels). */
  maxWidth?: number;
}

/** Collapses embedded newlines/tabs/runs of spaces into single spaces. Cell content often comes
 *  from raw error text (e.g. a multi-line `git` stderr dump folded into a `DiagnosticResult`
 *  message) -- left as-is, an embedded `\n` would print mid-cell and break every border below it,
 *  not just wrap unusually. */
function normalizeCellText(text: string): string {
  return text.replace(/\s+/g, LAYOUT.SPACE).trim();
}

/** Greedy word-wrap into lines no longer than `width` (an unbreakable word may still exceed it --
 *  matches standard terminal word-wrap: overflow, not mid-word mangling). Assumes `text` has
 *  already been through `normalizeCellText`. */
function wrapCell(text: string, width: number): string[] {
  if (text.length <= width) return [text];

  const words = text.split(LAYOUT.SPACE);
  const lines: string[] = [];
  let current: string = LAYOUT.EMPTY;
  for (const word of words) {
    const candidate = current ? `${current}${LAYOUT.SPACE}${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function padCell(text: string, width: number): string {
  return text + LAYOUT.SPACE.repeat(Math.max(0, width - text.length));
}

function buildBorder(
  widths: number[],
  left: string,
  mid: string,
  right: string,
): string {
  return (
    left +
    widths.map((w) => BOX_CHARS.HORIZONTAL.repeat(w + 2)).join(mid) +
    right
  );
}

function buildLine(cells: string[], widths: number[]): string {
  const padded = cells.map((cell, i) =>
    padCell(cell ?? LAYOUT.EMPTY, widths[i]),
  );
  return `${BOX_CHARS.VERTICAL} ${padded.join(` ${BOX_CHARS.VERTICAL} `)} ${BOX_CHARS.VERTICAL}`;
}

function computeColumnWidths(
  columns: TableColumn[],
  rows: string[][],
): number[] {
  return columns.map((col, i) => {
    const natural = Math.max(
      col.header.length,
      ...rows.map((row) => (row[i] ?? LAYOUT.EMPTY).length),
    );
    return col.maxWidth ? Math.min(natural, col.maxWidth) : natural;
  });
}

/**
 * Renders a bordered, human-scannable table that is equally easy for a piped/AI-agent reader to
 * parse: fixed column count, `│`-delimited cells, no ANSI color inside the grid (status is
 * shape-coded via `STATUS_ICONS`, not color-coded).
 */
export function renderTable(
  columns: TableColumn[],
  rows: string[][],
): string[] {
  const headers = columns.map((c) => normalizeCellText(c.header));
  const normalizedRows = rows.map((row) =>
    row.map((cell) => normalizeCellText(cell ?? LAYOUT.EMPTY)),
  );

  const widths = computeColumnWidths(
    columns.map((c, i) => ({ ...c, header: headers[i] })),
    normalizedRows,
  );
  const wrappedRows = normalizedRows.map((row) =>
    columns.map((_col, i) => wrapCell(row[i] ?? LAYOUT.EMPTY, widths[i])),
  );

  const lines: string[] = [
    buildBorder(
      widths,
      BOX_CHARS.TOP_LEFT,
      BOX_CHARS.T_DOWN,
      BOX_CHARS.TOP_RIGHT,
    ),
    buildLine(headers, widths),
    buildBorder(widths, BOX_CHARS.T_RIGHT, BOX_CHARS.CROSS, BOX_CHARS.T_LEFT),
  ];

  for (const wrapped of wrappedRows) {
    const height = Math.max(...wrapped.map((cellLines) => cellLines.length));
    for (let lineIndex = 0; lineIndex < height; lineIndex++) {
      lines.push(
        buildLine(
          wrapped.map((cellLines) => cellLines[lineIndex] ?? LAYOUT.EMPTY),
          widths,
        ),
      );
    }
  }

  lines.push(
    buildBorder(
      widths,
      BOX_CHARS.BOTTOM_LEFT,
      BOX_CHARS.T_UP,
      BOX_CHARS.BOTTOM_RIGHT,
    ),
  );
  return lines;
}

/** Renders an auto-sized single-line-title banner, e.g. for `ui.header()`. */
export function renderBanner(title: string): string[] {
  const horizontal = BOX_CHARS.HORIZONTAL.repeat(title.length + 2);
  return [
    `${BOX_CHARS.TOP_LEFT}${horizontal}${BOX_CHARS.TOP_RIGHT}`,
    `${BOX_CHARS.VERTICAL} ${title} ${BOX_CHARS.VERTICAL}`,
    `${BOX_CHARS.BOTTOM_LEFT}${horizontal}${BOX_CHARS.BOTTOM_RIGHT}`,
  ];
}
