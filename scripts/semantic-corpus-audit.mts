/** Offline evaluation composition root. No product graph/model initialization. */
import "../lib/core/src/index.js";
import {
  docuviaFactory,
  DocuviaError,
  ErrorCodes,
  TOKENS,
} from "../lib/contracts/src/index.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const USAGE =
  "Usage: pnpm run eval:semantic --input corpus.json --output report.json";

function argumentsFor(args: string[]): { input: string; output: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      !["--input", "--output"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      values.has(key)
    ) {
      throw new DocuviaError(ErrorCodes.SEMANTIC_CORPUS_INVALID, USAGE);
    }
    values.set(key, value);
  }
  if (values.size !== 2)
    throw new DocuviaError(ErrorCodes.SEMANTIC_CORPUS_INVALID, USAGE);
  return {
    input: resolve(values.get("--input")!),
    output: resolve(values.get("--output")!),
  };
}

function checkInputSize(bytes: number): void {
  if (bytes > MAX_INPUT_BYTES)
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_CORPUS_INVALID,
      "Corpus JSON exceeds 64 MiB",
    );
}

function readBoundedSnapshot(input: string): Buffer {
  const descriptor = openSync(input, "r");
  try {
    const stats = fstatSync(descriptor);
    checkInputSize(stats.size);
    if (!stats.isFile())
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_CORPUS_INVALID,
        "Corpus input must be a regular file",
      );
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(
        Math.min(64 * 1024, MAX_INPUT_BYTES - total + 1),
      );
      const count = readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) return Buffer.concat(chunks, total);
      total += count;
      checkInputSize(total);
      chunks.push(chunk.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
}

function readManifest(input: string, output: string): unknown {
  const canonicalInput = realpathSync(input);
  const canonicalOutput = existsSync(output) ? realpathSync(output) : output;
  if (canonicalInput === canonicalOutput) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_CORPUS_INVALID,
      "Input and output must be different files",
    );
  }
  const bytes = readBoundedSnapshot(input);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_CORPUS_INVALID,
      "Corpus must contain valid UTF-8 JSON",
      cause,
    );
  }
}

function writeReport(output: string, report: unknown): void {
  mkdirSync(dirname(output), { recursive: true });
  const temporary = mkdtempSync(join(dirname(output), ".semantic-corpus-"));
  try {
    const file = join(temporary, "report.json");
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    renameSync(file, output);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const { input, output } = argumentsFor(process.argv.slice(2));
  const manifest = readManifest(input, output);
  const report = docuviaFactory
    .resolve(TOKENS.SemanticCorpusService)
    .audit(manifest);
  writeReport(output, report);
  process.stdout.write(
    `${JSON.stringify({ corpusId: report.corpusId, datasetHash: report.datasetHash, gates: report.gates })}\n`,
  );
  process.exitCode = Object.values(report.gates).every(
    (gate) => gate === "pass",
  )
    ? 0
    : 2;
} catch (cause) {
  const error = DocuviaError.wrap(
    ErrorCodes.SEMANTIC_CORPUS_IO_FAILED,
    "Semantic corpus audit failed",
    cause,
  );
  process.stderr.write(
    `${JSON.stringify({ code: error.code, message: error.message })}\n`,
  );
  process.exitCode = 1;
}
