import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TIER_B_LANGUAGE_IDS } from "@workspace/contracts";
import { partitionTierBBucket } from "./tier-b-project-partitioner.js";

describe("partitionTierBBucket() path containment", () => {
  it("drops symlinked project references that escape workspace", () => {
    if (process.platform === "win32") return;

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-symlink-"),
    );
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-outside-"),
    );

    try {
      const projectRoot = path.join(root, "packages", "a");
      fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ name: "a" }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(projectRoot, "tsconfig.json"),
        JSON.stringify({ references: [{ path: "../escape" }] }),
        "utf8",
      );
      fs.writeFileSync(path.join(projectRoot, "src", "index.ts"), "", "utf8");
      fs.symlinkSync(outside, path.join(root, "packages", "escape"), "dir");

      const partition = partitionTierBBucket({
        workspaceRoot: root,
        languageId: TIER_B_LANGUAGE_IDS.TYPESCRIPT,
        files: ["packages/a/src/index.ts"],
      });

      expect(partition.groups).toHaveLength(1);
      expect(partition.groups[0].root).toBe(projectRoot);
      expect(partition.groups[0].deps).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
