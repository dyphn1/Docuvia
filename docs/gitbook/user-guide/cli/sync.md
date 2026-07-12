# `docuvia sync`

The `sync` command synchronizes the local Docuvia state with the remote Cloud API Server. 

> **Note on Docuvia2:** Currently, `sync` only implements the client-side stub to fetch updates from the server. Advanced server-side multi-tenant handshakes are deferred.

## Usage

```bash
docuvia sync
```

## Under the Hood

When you run `docuvia sync`:

1. **Remote API Provider**: The `FetchRemoteSyncClient` (`lib/remote-api`) establishes a connection to the configured Docuvia server.
2. **Timeout & Error Handling**: A strict 30s timeout is enforced. All HTTP or JSON parsing errors are caught and wrapped in a structured `DocuviaError`.
3. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/sync.log`.

## Examples

Run a synchronization:
```bash
docuvia sync
```
