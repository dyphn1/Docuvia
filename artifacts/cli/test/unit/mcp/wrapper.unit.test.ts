import { describe, it, expect } from "vitest";
import { withErrorHandling } from "../../../src/mcp/tools/wrapper.js";

describe("withErrorHandling", () => {
  it("should return the result if handler succeeds", async () => {
    const handler = async (args: any) => ({ content: [{ type: "text", text: "Success" }] });
    const wrapped = withErrorHandling("Error", handler);

    const result = await wrapped({});
    expect(result).toEqual({ content: [{ type: "text", text: "Success" }] });
  });

  it("should return formatted error if handler throws", async () => {
    const handler = async (args: any) => {
      throw new Error("Failed");
    };
    const wrapped = withErrorHandling("Prefix", handler);

    const result = await wrapped({});
    expect(result).toEqual({
      content: [{ type: "text", text: "Prefix: Failed" }],
      isError: true,
    });
  });
});
