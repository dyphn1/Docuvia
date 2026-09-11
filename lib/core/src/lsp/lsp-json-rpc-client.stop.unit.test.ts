import { describe, it, expect } from "vitest";
import { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { LSP_MESSAGES } from "./lsp-constants.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

describe("LspJsonRpcClient stop()", () => {
  it(
    "rejects pending requests and releases child transport state immediately",
    async () => {
      const client = new LspJsonRpcClient();
      await client.start({
        command: process.execPath,
        args: [
          "-e",
          "process.stdin.resume(); setInterval(() => undefined, 1000);",
        ],
        cwd: process.cwd(),
      });

      const child = (client as any).child;
      const pending = client.request("never-respond", {}, 60_000);
      const settled = Promise.allSettled([pending]);

      await client.stop();
      const [result] = await settled;

      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(Error);
        expect((result.reason as Error).message).toBe(
          LSP_MESSAGES.clientStoppedBeforeResponse,
        );
      }
      expect((client as any).pending.size).toBe(0);
      expect((client as any).child).toBeUndefined();
      expect((client as any).buffer.length).toBe(0);
      expect((client as any).stderrTail).toBe("");
      expect(child.stdout.listenerCount("data")).toBe(0);
      expect(child.stderr.listenerCount("data")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);

      await expect(client.stop()).resolves.toBeUndefined();
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
