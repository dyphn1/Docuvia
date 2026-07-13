# IPC Logging Architecture

> **Mandatory Architecture Protocol:**
> When executing logic in an isolated context (such as a `worker_thread` or a `child_process`), direct interaction with the main thread's `ILogger` or `docuviaMemory` is physically impossible due to V8 memory isolation.
> To maintain the **Virtual Contracts Architecture** (no direct `console.log`) and **UUID Scoping** (no cross-workspace log bleeding), all isolated contexts must use the **IPC Logger Protocol**.

---

## 1. The Physical Limitation

In Node.js, `worker_threads` and `child_process` spawn entirely new, independent V8 JavaScript engines.

1. **Isolated Memory**: The `docuviaMemory` imported inside a worker is an empty, new instance. It does not contain the configuration or logger instances from the main thread.
2. **Unclonable Functions**: We cannot pass the `ILogger` instance (which contains functions like `.info()`) via `workerData` or `postMessage()`, as the `structuredClone` algorithm strictly forbids cloning functions.

## 2. The Solution: IPC Logger Client & Direct Router Injection

Instead of forcing developers to write manual `postMessage()` calls every time they need to log an error in a worker, we abstract this behind the exact same `ILogger` interface used in the main thread.

### The Mechanism

1. **The Context/UUID Setup**: When the main thread spawns a worker, it must establish a communication channel (like `parentPort` or a process IPC channel).
2. **The IPC Logger Client (`lib/contracts`)**: Inside the worker, we instantiate an `IpcLoggerClient`. This class fully implements the `ILogger` interface (`info`, `warn`, `error`, etc.). However, under the hood, it serializes the log into a standard JSON payload:
   ```json
   {
     "type": "ipc-log",
     "level": "error",
     "message": "Worker crashed",
     "context": { "details": "..." }
   }
   ```
   No `uuid` field: routing does not go through `docuviaMemory` at all (see below), so there is nothing for one to key.
3. **The IPC Log Router (Main Thread)**: The main thread listens for messages from the worker. Because the component spawning the worker (e.g., `AstWorkerPool`) **already receives the per-request `ILogger` instance from the Factory parameters** during resolution, there is no need to perform a global lookup in `docuviaMemory`. The parent simply instantiates an `IpcLogRouter(this.logger)` and pipes incoming `"ipc-log"` messages directly to it.

## 3. Implementation Rules

- **Never use `console.log` in a worker**: Standard output streams might be merged or intercepted incorrectly (e.g., corrupting an MCP JSON-RPC stream).
- **Workers remain oblivious**: The worker code should only expect an `ILogger` interface. It shouldn't care whether the logger is an `IpcLoggerClient` or a direct console logger.
- **Main Thread routing is mandatory**: Any service in `lib/ui-core` or `lib/core` that spawns a worker MUST route incoming `"ipc-log"` messages through the shared IPC Log Router infrastructure.
