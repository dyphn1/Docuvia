import path from "node:path";
import { describe, expect, it } from "vitest";
import { system1EvalOutputDirectory } from "./system1-eval-output.js";

describe("System-1 evaluation output directory", () => {
  it("[happy] places v1 evaluation results beside the selected v1 dataset", () => {
    expect(system1EvalOutputDirectory("/corpus/v1/system1-dataset/")).toBe(
      path.resolve("/corpus/v1/system1-eval"),
    );
  });

  it("preserves the selected dataset version in the evaluation directory", () => {
    expect(system1EvalOutputDirectory("/corpus/v1/system1-dataset-v2")).toBe(
      path.resolve("/corpus/v1/system1-eval-v2"),
    );
  });

  it("[invalid-input] [error-handling] rejects dataset directories without the supported naming convention", () => {
    expect(() => system1EvalOutputDirectory("/corpus/v1/dataset")).toThrow(
      "System-1 dataset directory must be named system1-dataset or system1-dataset-vN.",
    );
  });
});
