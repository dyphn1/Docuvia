/** C-07 replay comparison (#506): compares two independent collection outputs on every
 *  correctness-bearing field. Usage: pnpm run eval:semantic:replay --a <out1> --b <out2> */
import { readFileSync } from "node:fs";
import path from "node:path";
import { compareReplays } from "../../lib/core/src/semantic/collection/semantic-collection-reporting.js";
import { argsFor, writeJson } from "./run-support.mjs";

/** Wall-clock fields (and the timing-driven readiness poll count) only; everything else must match byte-for-byte after parsing. */
export const TIMING_KEYS = ["durationMs", "readyMs", "readinessProbeRequests"];
const COMPARED = [
  "corpus-manifest.json",
  "corpus-report.json",
  "collection-report.json",
  "audit-worksheet.json",
];

const args = argsFor(process.argv.slice(2), ["--a", "--b"]);
const read = (dir: string, file: string): unknown =>
  JSON.parse(readFileSync(path.join(dir, file), "utf8"));
const files = COMPARED.map((file) => ({
  file,
  mismatches: compareReplays(
    read(args["--a"], file),
    read(args["--b"], file),
    TIMING_KEYS,
  ),
}));
const result = {
  a: path.resolve(args["--a"]),
  b: path.resolve(args["--b"]),
  ignoredTimingKeys: TIMING_KEYS,
  files,
  identical: files.every((f) => f.mismatches.length === 0),
};
if (args["--out"]) writeJson(args["--out"], result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.identical ? 0 : 2;
