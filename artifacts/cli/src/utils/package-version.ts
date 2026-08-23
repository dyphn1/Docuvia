import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";

let cachedVersion: string | undefined;

/**
 * Single source of truth for the shipped version, read from the CLI package.json.
 * Consumed by both `docuvia --version` and the MCP initialize handshake — semantic-release
 * bumps that one file's version on release and every surface follows.
 *
 * The lookup walks up from this module because the module's depth differs between
 * environments: under vitest this file sits at `src/utils/` (two levels below the package
 * root), while the tsup bundle flattens it next to `dist/cli.js` (one level below) — a
 * static relative path can't satisfy both.
 */
export function getPackageVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion;
  }

  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = createRequire(import.meta.url)(candidate) as {
        version?: unknown;
      };
      if (typeof pkg.version !== "string") {
        throw DocuviaError.wrap(
          ErrorCodes.FS_READ_FAILED,
          `Package manifest at ${candidate} has no string "version" field`,
          undefined,
        );
      }
      cachedVersion = pkg.version;
      return cachedVersion;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw DocuviaError.wrap(
    ErrorCodes.FS_READ_FAILED,
    "Could not locate the CLI package.json by walking up from the running module",
    undefined,
  );
}
