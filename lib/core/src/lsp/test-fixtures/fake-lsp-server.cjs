#!/usr/bin/env node
/**
 * Minimal fake LSP server for LspJsonRpcClient's wire-protocol tests -- speaks the same
 * Content-Length-framed JSON-RPC 2.0 stdio transport as a real language server, without being
 * one. Canned per-method responses:
 *   - "initialize"      -> { capabilities: {} }
 *   - "echo"             -> params (round-trips whatever was sent, for correlation tests)
 *   - "hang"              -> never responds (times out on the client side)
 *   - "delay"             -> responds after 150ms (proves a longer-than-typical-timeout wait
 *                            still resolves normally when the client passed timeoutMs: 0)
 *   - "shutdown"          -> null, then exits on the "exit" notification
 * Not a general-purpose LSP server -- only what the test suite needs.
 */
let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

function processBuffer() {
  for (;;) {
    const sepIndex = buffer.indexOf("\r\n\r\n");
    if (sepIndex === -1) return;
    const header = buffer.subarray(0, sepIndex).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(sepIndex + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = sepIndex + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    handleMessage(body);
  }
}

function send(message) {
  const payload = JSON.stringify(message);
  const header = "Content-Length: " + Buffer.byteLength(payload, "utf8") + "\r\n\r\n";
  process.stdout.write(header + payload);
}

function handleMessage(body) {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch {
    return;
  }
  if (msg.id === undefined) {
    if (msg.method === "exit") process.exit(0);
    return; // other notifications ignored
  }
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
    return;
  }
  if (msg.method === "echo") {
    send({ jsonrpc: "2.0", id: msg.id, result: msg.params });
    return;
  }
  if (msg.method === "hang") {
    return; // never respond
  }
  if (msg.method === "delay") {
    setTimeout(() => send({ jsonrpc: "2.0", id: msg.id, result: msg.params }), 150);
    return;
  }
  if (msg.method === "fail") {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -1, message: "fake failure" } });
    return;
  }
  if (msg.method === "shutdown") {
    send({ jsonrpc: "2.0", id: msg.id, result: null });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, result: null });
}
