import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/**
 * Parses the `DOCUVIA_LSP_ARGS` env var into an argv array (issue #74).
 *
 * Two accepted forms, both of which land in `spawn(cmd, args)`'s argument *array* (never a
 * shell string), so no metacharacters are ever interpreted:
 *
 * 1. **JSON array of strings** — `'["--tsserver-path","C:\\Program Files\\x"]'` (detected by a
 *    leading `[`). The unambiguous form for args containing spaces/quotes/backslashes. A leading
 *    `[` that fails to parse, or a non-string element, is a loud `INVALID_INPUT` error -- an
 *    operator who opted into the JSON form gets told their config is broken rather than having it
 *    silently re-interpreted.
 * 2. **POSIX-style word splitting** (the pre-#74 behavior, kept for backward compatibility) --
 *    `--foo "bar baz" 'a b' c\\ d` splits on whitespace outside quotes, with single/double quotes
 *    grouping and `\` escaping the next character. The old naive `raw.split(" ")` handed quoted
 *    arguments to the LSP as literal `"bar`/`baz"` tokens; this tokenizer does not.
 *
 * Returns `undefined` for an absent/blank value (mirrors the pre-fix `lspArgsRaw ? ... : undefined`
 * contract -- no override means "use the server's defaults").
 */
export function parseLspArgs(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new DocuviaError(
        ErrorCodes.INVALID_INPUT,
        UI_MESSAGES.ANALYZE_LSP_ARGS_INVALID_JSON(String(err)),
      );
    }
    if (!Array.isArray(parsed) || parsed.some((e) => typeof e !== "string")) {
      throw new DocuviaError(
        ErrorCodes.INVALID_INPUT,
        UI_MESSAGES.ANALYZE_LSP_ARGS_INVALID_SHAPE,
      );
    }
    return parsed;
  }

  return splitShellWords(trimmed);
}

/**
 * Minimal POSIX-like word splitter: whitespace separates tokens, single/double quotes group a
 * token (with `\"` and `\\` honored inside double quotes), and a backslash escapes the next
 * character outside quotes. Deliberately *not* a full shell: no variable/glob/command expansion,
 * since the result is spawned as an argv array with `shell: false`.
 *
 * Unterminated quotes are consumed leniently to end-of-input (the operator's intent is
 * unambiguous) rather than rejected.
 */
/** True when `ch` is a backslash escaping `"` or `\\` inside a double-quoted region (POSIX). */
function isDoubleQuoteEscape(ch: string, next: string | undefined): boolean {
  return ch === "\\" && next !== undefined && (next === '"' || next === "\\");
}

/** Type guard for either quote character. */
function isQuoteChar(ch: string): ch is '"' | "'" {
  return ch === '"' || ch === "'";
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/** Appends `current` to `tokens` when non-empty and returns a fresh buffer. */
function flushToken(tokens: string[], current: string): string {
  if (current.length > 0) tokens.push(current);
  return "";
}

export function splitShellWords(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (quote !== null) {
      if (ch === quote) quote = null;
      // POSIX: inside double quotes a backslash is special only before `"`, `\\`, `$` and a
      // backtick -- before any other character it stays literal (so `C:\\Program Files` keeps
      // its backslashes). We only expand `"`/`\\`; `$`/backtick aren't expanded anyway. Inside
      // single quotes a backslash is fully literal.
      else if (quote === '"' && isDoubleQuoteEscape(ch, next)) {
        current += next as string;
        i++;
      } else current += ch;
      continue;
    }

    if (isQuoteChar(ch)) {
      quote = ch;
    } else if (ch === "\\" && next !== undefined) {
      current += next;
      i++;
    } else if (isWhitespace(ch)) {
      current = flushToken(tokens, current);
    } else {
      current += ch;
    }
  }

  flushToken(tokens, current);
  return tokens;
}
