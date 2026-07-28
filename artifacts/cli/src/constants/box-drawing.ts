/**
 * Box-drawing characters and status icons shared by `ui.header`/`ui.section`/`ui.table`
 * (`../ui/table.js`, `../ui/wizard.js`). One glyph set for every command's banners, section
 * headers, and tables so terminal output stays visually consistent (IFCE CLI output-style pass)
 * and stays plain-text/parseable for a piped AI-agent reader (no ANSI, stable characters).
 */
export const BOX_CHARS = {
  TOP_LEFT: "┌",
  TOP_RIGHT: "┐",
  BOTTOM_LEFT: "└",
  BOTTOM_RIGHT: "┘",
  HORIZONTAL: "─",
  VERTICAL: "│",
  T_DOWN: "┬",
  T_UP: "┴",
  T_RIGHT: "├",
  T_LEFT: "┤",
  CROSS: "┼",
} as const;

/** Status glyphs for table `Status` cells -- shape-coded (not color-coded) so meaning survives
 *  both a non-TTY/piped agent reader and a colorblind human reader. */
export const STATUS_ICONS = {
  PASS: "✓",
  FAIL: "✗",
} as const;

/** Marker prefixed to `ui.section()` titles. */
export const SECTION_ICON = "◆";
