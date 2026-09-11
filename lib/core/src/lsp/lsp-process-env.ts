/** Environment variables required by LSP child processes for binary lookup,
 * home-relative configuration, Windows command resolution, and locale/terminal behavior.
 * Intentionally excludes credentials and unrelated parent-process state. */
const LSP_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "PATHEXT",
  "SYSTEMROOT",
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "TERM",
] as const;

/** Builds the minimal environment inherited by an LSP child process. */
export function buildMinimalLspEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of LSP_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
