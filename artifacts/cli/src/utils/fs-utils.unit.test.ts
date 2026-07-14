import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

// `writeOrAppend` imports `fs/promises` (no `node:` prefix) — mock that exact specifier so the
// module under test picks up the mocked `readFile`, wrapped around the real implementation so
// every other call behaves normally except where a test overrides it with `mockRejectedValueOnce`.
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

import * as fs from "fs/promises";
import { writeOrAppend } from "./fs-utils.js";

const tempDirs: string[] = [];

async function makeTargetPath(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "docuvia-fs-utils-test-"),
  );
  tempDirs.push(dir);
  return path.join(dir, "instructions.md");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("writeOrAppend()", () => {
  it("creates the file silently when it does not exist yet (ENOENT)", async () => {
    const filePath = await makeTargetPath();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await writeOrAppend(filePath, "content", "marker");

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("content");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("appends when the marker is missing from the existing file", async () => {
    const filePath = await makeTargetPath();
    await fs.writeFile(filePath, "existing content");

    await writeOrAppend(filePath, "new block [marker]", "[marker]");

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe(
      "existing content\nnew block [marker]",
    );
  });

  it("does not duplicate when the marker is already present", async () => {
    const filePath = await makeTargetPath();
    await fs.writeFile(filePath, "existing [marker] content");

    await writeOrAppend(filePath, "new block [marker]", "[marker]");

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe(
      "existing [marker] content",
    );
  });

  it("warns instead of silently clobbering when the read fails for a reason other than ENOENT", async () => {
    const filePath = await makeTargetPath();
    await fs.writeFile(filePath, "existing content");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readError = Object.assign(new Error("EACCES"), { code: "EACCES" });
    (fs.readFile as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      readError,
    );

    await writeOrAppend(filePath, "new content", "marker");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("EACCES");
    // Falls back to creating/overwriting, same as the ENOENT path — the warning is what changed.
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("new content");
  });
});
