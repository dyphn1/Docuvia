/**
 * Trimmed to what `init` needs (per the migration plan's step 8) — the fuller set
 * (`--deep`, `--local`, `--format=`, `--baseRef=`, `--topology`, etc.) belongs to
 * commands (`analyze`, `query`, `export`, ...) that don't exist in this milestone yet.
 * Port the rest in alongside each command as it's rebuilt.
 */
export const CLI_FLAGS = {
  GLOBAL: "--global",
} as const;
