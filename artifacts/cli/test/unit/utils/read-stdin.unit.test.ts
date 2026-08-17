import { describe, it, expect, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import process from "node:process";
import { readStdin } from "../../../src/utils/read-stdin.js";

describe("readStdin", () => {
  const originalStdinDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "stdin",
  );

  afterEach(() => {
    if (originalStdinDescriptor) {
      Object.defineProperty(process, "stdin", originalStdinDescriptor);
    }
  });

  function stubStdin(): PassThrough {
    const input = new PassThrough();
    Object.defineProperty(process, "stdin", {
      value: input,
      configurable: true,
      writable: true,
    });
    return input;
  }

  it("resolves with the trimmed concatenated lines once stdin closes", async () => {
    const input = stubStdin();
    const promise = readStdin();

    input.write("hello\nworld\n");
    input.end();

    await expect(promise).resolves.toBe("hello\nworld");
  });

  it("explicitly closes the readline interface (issue #72) so its stream listeners are released", async () => {
    const input = stubStdin();
    const promise = readStdin();

    input.end("single line\n");

    await expect(promise).resolves.toBe("single line");
    // readline's async iteration attaches a 'readable' listener to consume the stream; the
    // explicit rl.close() in readStdin must have removed it, so the stub stream is left with no
    // lingering references (the pre-fix implementation left the interface open).
    expect(input.listenerCount("readable")).toBe(0);
  });
});
