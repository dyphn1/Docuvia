# `docuvia sync`

The `sync` command synchronizes the local Docuvia state with the remote Cloud API Server.

> **Note on Docuvia2:** Currently, `sync` only implements the client-side stub to fetch updates from the server. Advanced server-side multi-tenant handshakes are deferred.

## Usage

```bash
docuvia sync [projectId] [flags]
```

## Options

### Arguments

- `[projectId]`: The remote project ID to synchronize with. If omitted, the command will fail-fast unless `--interactive` is used to prompt for it.

### Flags

- `--commitSha=<sha>`: Specify the source commit SHA to synchronize. If omitted and stdin is piped (e.g., from a pre-push hook), Docuvia will attempt to read the SHA from stdin.
- `--interactive`, `-i`: Opt-in to interactive prompts (e.g., to prompt for the missing `projectId`).

## Under the Hood

When you run `docuvia sync`:

1. **Remote API Provider**: The `FetchRemoteSyncClient` (`lib/remote-api`) establishes a connection to the configured Docuvia server.
2. **Environment Configuration**: Requires `DOCUVIA_API_URL` and `MCP_PAT` environment variables to be set.
3. **Timeout & Error Handling**: A strict 30s timeout is enforced. All HTTP or JSON parsing errors are caught and wrapped in a structured `DocuviaError`.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/sync.log`.

## Examples

Run synchronization with a specific project ID:

```bash
docuvia sync my-project-123
```

Interactive synchronization:

```bash
docuvia sync --interactive
```
