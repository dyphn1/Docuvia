/**
 * Punctuation/whitespace markers used when composing human-readable CLI output
 * (spinner text, `ui.log`/`ui.warn` lines). Shared across commands that build up
 * strings by concatenation rather than a single template literal — e.g. wrapping a
 * user-supplied target name in quotes, or indenting a list entry.
 */
export const OUTPUT_FORMAT_MARKERS = {
  INDENT_TWO: "  ",
  NEWLINE: "\n",
  OPEN_PAREN: " (",
  CLOSE_PAREN: ")",
  DOUBLE_QUOTE: '"',
  EMPTY: "",
} as const;
