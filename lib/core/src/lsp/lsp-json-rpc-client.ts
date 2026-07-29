import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { LspWireConstants, LSP_MESSAGES } from "./lsp-constants.js";

const execFileAsync = promisify(execFile);

export interface LspJsonRpcClientOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Overrides the spawned process's environment (defaults to inheriting `process.env`, same as
   *  a bare `spawn()` call with no `env` option -- only ever overridden by tests today, e.g. to
   *  point `PATH` at a fixture wrapper instead of a real `npx`). */
  env?: NodeJS.ProcessEnv;
}

/** Extensions Windows can only execute through a shell (`cmd.exe`/PowerShell), never directly via
 *  `CreateProcess` -- exactly the extensions `resolveLspBinary()` tries first for a `node_modules/
 *  .bin` shim (`.cmd`, and `.bat`/`.ps1` for completeness). Anything else -- including a bare,
 *  unresolvable command name -- is spawned exactly as before, so the ordinary Windows `ENOENT`
 *  spawn-failure path (an immediate `error` event, no shell involved) is untouched. */
const WINDOWS_SHELL_ONLY_EXTENSIONS = new Set([".cmd", ".bat", ".ps1"]);

/** Bare command names this codebase spawns directly (never through a resolved `node_modules/.bin`
 *  path, so they never carry a `.cmd`/`.ps1` extension for the check above to catch) that are
 *  nonetheless *also* only ever installed as a `.cmd`/`.ps1` shim on Windows -- `npx` is the
 *  `npx --no-install <package>` fallback every npm/npx-strategy language's binary resolver falls
 *  back to (`lsp-binary-resolver.ts`/`resolveNpmNpxBinary()` in `lsp-binary-resolver-strategies.ts`)
 *  when no local copy is found. Plain `child_process.spawn()` cannot exec these directly on
 *  Windows, for the exact same reason as the resolved-shim-path case above -- confirmed by direct
 *  testing during the multi-language-lsp-support plan's Slice 1 (Python): a real
 *  `npx --no-install --package pyright pyright-langserver --stdio` spawn failed with a bare
 *  `ENOENT` on Windows before this fix (this bug pre-dates Slice 1 -- it affects TypeScript's own
 *  `npx` fallback identically, just never exercised by a real spawn in this repo's test suite
 *  until now). */
const WINDOWS_SHELL_ONLY_BARE_COMMANDS = new Set(["npx"]);

/** Full stdio pipe wiring (stdin/stdout/stderr all piped) — shared by both `spawn()` branches
 *  below. Returns a fresh array each call: `child_process.spawn()`'s `stdio` option type isn't
 *  `readonly`, and a shared mutable array risks aliasing across concurrent spawns. */
function stdioAllPiped(): ["pipe", "pipe", "pipe"] {
  return ["pipe", "pipe", "pipe"];
}

function needsWindowsShellWrapper(command: string): boolean {
  if (process.platform !== "win32") return false;
  return (
    WINDOWS_SHELL_ONLY_EXTENSIONS.has(path.extname(command).toLowerCase()) ||
    WINDOWS_SHELL_ONLY_BARE_COMMANDS.has(command.toLowerCase())
  );
}

/** Double-quotes a single `cmd.exe` command-line token, doubling any embedded `"` (cmd.exe's own
 *  escaping convention) -- used only for the narrow `.cmd`/`.bat`/`.ps1` case below, each argument
 *  individually, never a blanket unescaped `shell: true` + array-args (that pattern -- the one
 *  Node's `DEP0190` deprecation warns about -- concatenates args into the shell string verbatim,
 *  which is a real injection risk the moment any arg contains a shell metacharacter). */
function quoteForWindowsShell(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

/** Short timeout for the live `where` probe below -- a cheap PATH lookup, not the batch itself. */
const WHERE_PROBE_TIMEOUT_MS = 5000;

/**
 * Resolves a bare command name (only ever `"npx"` today) to its actual full path via a live
 * `where` probe on Windows -- necessary because invoking a bare-named `.cmd` shim (`npx`) through
 * a `cmd.exe shell: true` wrapper (the fix above) triggers a real, separately-confirmed npm/npx
 * bug: the shim's own internal bootstrapping re-resolves one of its own files
 * (`node_modules/npm/bin/npm-prefix.js`) relative to the *spawned process's `cwd`* instead of
 * its own install directory, when it was reached via a bare-name shell PATH search rather than
 * its full path -- reproduced directly during the multi-language-lsp-support plan's Slice 1 (a
 * real `pyright-langserver` spawn exited immediately with `MODULE_NOT_FOUND` for a path relative
 * to `cwd`, every time `workspaceRoot` had no such `node_modules/npm/bin/...` file, i.e. always);
 * invoking the shell wrapper with `npx`'s already-resolved full path sidesteps the bug entirely
 * (confirmed fixed by the same direct reproduction). Falls back to the bare command name
 * unresolved if the probe itself fails (e.g. `npx` genuinely isn't on `PATH` at all) -- preserves
 * an honest spawn failure in that case, just surfaced via the shell's own "command not found"
 * exit instead of a synchronous Node `ENOENT` `error` event.
 */
async function resolveWindowsBareCommandPath(
  command: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("where", [command], {
      timeout: WHERE_PROBE_TIMEOUT_MS,
      env,
    });
    const first = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return first ?? command;
  } catch {
    return command;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * A minimal LSP transport client: `Content-Length`-framed JSON-RPC 2.0 over a spawned process's
 * stdio (Language Server Protocol base spec) — request/response correlation by numeric id, plus
 * fire-and-forget notifications. Deliberately does not implement the full LSP capability
 * negotiation surface; only what `TypescriptLspEdgeProvider` needs
 * (`initialize`/`textDocument/didOpen`/`textDocument/documentSymbol`/`textDocument/references`/
 * `shutdown`/`exit`). No third-party JSON-RPC/LSP client dependency — hand-rolled so
 * `typescript-language-server` (or a test fixture speaking the same wire format) never becomes a
 * bundled dependency of docuvia itself (phase1-decision-integration.md §8b: "never bundled").
 */
export class LspJsonRpcClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stopped = false;

  /** Spawns the server and resolves once the process has actually started (or rejects on a
   *  synchronous spawn failure, e.g. `ENOENT` for an unresolvable binary). */
  async start(options: LspJsonRpcClientOptions): Promise<void> {
    // `resolveLspBinary()` prefers a Windows `.cmd` shim (that's how `npm`/`pnpm` install a
    // pure-JS bin like `typescript-language-server` on Windows), and `node:child_process.spawn`
    // cannot exec a `.cmd`/`.bat`/`.ps1` file directly there -- it throws `EINVAL` synchronously.
    // We considered pulling in `cross-spawn` (the usual fix), but on Windows it unconditionally
    // routes *any* command it can't prove is a bare `.exe`/`.com` through a `cmd.exe` wrapper --
    // including a genuinely nonexistent binary name, which then reports `ENOENT` asynchronously
    // via a later `exit`-code-1` re-interpretation instead of the immediate, synchronous-ish
    // `error` event plain `spawn()` gives today (verified by direct comparison; this would have
    // silently changed `start()`'s spawn-failure contract for every caller). So: a narrow,
    // hand-rolled branch that *only* engages `shell: true` for the exact `.cmd`/`.bat`/`.ps1` case
    // that needs it, leaving every other command (including unresolvable ones) spawned exactly as
    // before. A blanket `shell: true` with the `args` array as-is would reintroduce
    // shell-metacharacter injection (and trigger Node's `DEP0190` deprecation, which exists
    // precisely because array args get concatenated into the shell string unescaped) -- so each
    // token is quoted individually into a single command string instead.
    const useShellWrapper = needsWindowsShellWrapper(options.command);
    // Bare commands (only `"npx"` today) need their own extra resolution step -- see
    // `resolveWindowsBareCommandPath()`'s doc comment for the separate real bug this sidesteps.
    const shellCommand =
      useShellWrapper &&
      WINDOWS_SHELL_ONLY_BARE_COMMANDS.has(options.command.toLowerCase())
        ? await resolveWindowsBareCommandPath(options.command, options.env)
        : options.command;
    const child = (
      useShellWrapper
        ? spawn(
            [shellCommand, ...options.args].map(quoteForWindowsShell).join(" "),
            {
              cwd: options.cwd,
              stdio: stdioAllPiped(),
              shell: true,
              env: options.env,
            },
          )
        : spawn(options.command, options.args, {
            cwd: options.cwd,
            stdio: stdioAllPiped(),
            env: options.env,
          })
    ) as ChildProcessWithoutNullStreams;
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.on("exit", (code) => this.onExit(code));
    child.on("error", (err) => this.onError(err));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      child.once("spawn", () => {
        settled = true;
        resolve();
      });
      child.once("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  /** Sends a request and resolves/rejects with the server's response, or rejects on `timeoutMs`.
   *  `timeoutMs === 0` means "never time out" -- no timer is set at all, so the request only ever
   *  settles via a real response or the process exiting/erroring (`rejectAllPending`). */
  request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (!this.child || this.stopped) {
      return Promise.reject(new Error(LSP_MESSAGES.clientNotRunning(method)));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                new Error(LSP_MESSAGES.requestTimedOut(method, timeoutMs)),
              );
            }, timeoutMs)
          : undefined;
      this.pending.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      });
      this.write({
        jsonrpc: LspWireConstants.JSON_RPC_VERSION,
        id,
        method,
        params,
      });
    });
  }

  /** Sends a notification (no response expected). Silently a no-op once the client has stopped —
   *  notifications (e.g. `textDocument/didOpen`) are best-effort during teardown. */
  notify(method: string, params: unknown): void {
    if (!this.child || this.stopped) return;
    this.write({ jsonrpc: LspWireConstants.JSON_RPC_VERSION, method, params });
  }

  /** Ends stdin and kills the process (best-effort; never throws). Idempotent. */
  async stop(): Promise<void> {
    if (!this.child || this.stopped) return;
    this.stopped = true;
    const child = this.child;
    try {
      child.stdin.end();
    } catch {
      // best-effort
    }
    try {
      child.kill();
    } catch {
      // best-effort
    }
  }

  private write(message: Record<string, unknown>): void {
    const payload = JSON.stringify(message);
    const header =
      `${LspWireConstants.CONTENT_LENGTH_HEADER_PREFIX}${Buffer.byteLength(payload, LspWireConstants.ENCODING)}` +
      LspWireConstants.HEADER_BODY_SEPARATOR;
    this.child!.stdin.write(header + payload, LspWireConstants.ENCODING);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const consumed = this.tryConsumeOneMessage();
      if (!consumed) return;
    }
  }

  /** Consumes exactly one framed message from `this.buffer` if a complete one is available.
   *  Returns `false` when the buffer holds an incomplete header or body (wait for more data). */
  private tryConsumeOneMessage(): boolean {
    const sepIndex = this.buffer.indexOf(
      LspWireConstants.HEADER_BODY_SEPARATOR,
    );
    if (sepIndex === -1) return false;

    const header = this.buffer
      .subarray(0, sepIndex)
      .toString(LspWireConstants.ENCODING);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    const bodyStart = sepIndex + LspWireConstants.HEADER_BODY_SEPARATOR.length;
    if (!match) {
      // Malformed header we don't recognize -- drop up to the separator and keep scanning
      // rather than getting stuck forever on a byte we can't frame.
      this.buffer = this.buffer.subarray(bodyStart);
      return this.buffer.length > 0;
    }

    const length = Number(match[1]);
    if (this.buffer.length < bodyStart + length) return false;

    const body = this.buffer
      .subarray(bodyStart, bodyStart + length)
      .toString(LspWireConstants.ENCODING);
    this.buffer = this.buffer.subarray(bodyStart + length);
    this.handleMessage(body);
    return true;
  }

  private handleMessage(body: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(body) as JsonRpcResponse;
    } catch {
      return;
    }
    if (msg.id === undefined) return; // a notification/request *from* the server -- ignored
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message));
    else pending.resolve(msg.result);
  }

  private onExit(code: number | null): void {
    this.stopped = true;
    this.rejectAllPending(new Error(LSP_MESSAGES.serverExited(code)));
  }

  private onError(err: Error): void {
    this.stopped = true;
    this.rejectAllPending(err);
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }
}
