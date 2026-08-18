import {
  CLI_OUTPUT_FORMATS,
  type CliOutputFormat,
} from "../constants/cli-flags.js";
import { CLI_ERROR_MESSAGES } from "../constants/cli-errors.js";

/**
 * Presentation-layer gate (roadmap item 31) for the shared `--format=` value shared by
 * `query`/`impact`/`review`. `undefined` (flag absent) is preserved so each command falls back to
 * its `human` default; an unknown value throws -- mirroring `checkUnknownFlags`'s throw-on-invalid
 * precedent, so a typo'd `--format=jsno` can never silently degrade to the human renderer and
 * corrupt a structured-output consumer (an agent, a pipe) with banners/prose it didn't ask for.
 */
export function resolveOutputFormat(
  raw: string | undefined,
): CliOutputFormat | undefined {
  if (raw === undefined) return undefined;
  const known = Object.values(CLI_OUTPUT_FORMATS) as string[];
  if (known.includes(raw)) return raw as CliOutputFormat;
  throw new Error(CLI_ERROR_MESSAGES.INVALID_FORMAT(raw, known.join(", ")));
}
