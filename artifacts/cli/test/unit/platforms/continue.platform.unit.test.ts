import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { ContinuePlatform } from "../../../src/platforms/continue.platform.js";
import { ui } from "../../../src/ui/wizard.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
} from "../../../src/constants/init-templates.js";
import { writeOrAppend } from "../../../src/utils/fs-utils.js";

vi.mock("fs/promises");
vi.mock("../../../src/ui/wizard.js", () => ({
  ui: { success: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../src/utils/fs-utils.js", () => ({
  writeOrAppend: vi.fn(),
}));

describe("ContinuePlatform", () => {
  let platform: ContinuePlatform;

  beforeEach(() => {
    vi.clearAllMocks();
    platform = new ContinuePlatform();
  });

  describe("installHooks", () => {
    it("writes its own dedicated rule file under .continue/rules/", async () => {
      await platform.installHooks("/workspace");

      expect(writeOrAppend).toHaveBeenCalledWith(
        path.join("/workspace", ".continue", "rules", "docuvia.md"),
        AGENT_INSTRUCTIONS,
        AGENT_INSTRUCTIONS_MARKER,
      );
    });
  });

  describe("uninstallHooks", () => {
    it("unlinks its own file outright, not a marker-block slice", async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.rmdir).mockResolvedValue(undefined);

      await platform.uninstallHooks("/workspace");

      expect(fs.unlink).toHaveBeenCalledWith(
        path.join("/workspace", ".continue", "rules", "docuvia.md"),
      );
      expect(ui.success).toHaveBeenCalledWith(
        expect.stringContaining("docuvia.md"),
      );
    });

    it("rmdirs the rules dir (non-recursive) after removing the file", async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.rmdir).mockResolvedValue(undefined);

      await platform.uninstallHooks("/workspace");

      expect(fs.rmdir).toHaveBeenCalledWith(
        path.join("/workspace", ".continue", "rules"),
      );
    });

    it("never touches .continue/ itself and tolerates a non-empty rules dir", async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.rmdir).mockRejectedValue(new Error("ENOTEMPTY"));

      await expect(
        platform.uninstallHooks("/workspace"),
      ).resolves.not.toThrow();

      expect(fs.rmdir).not.toHaveBeenCalledWith(
        path.join("/workspace", ".continue"),
      );
    });

    it("is a no-op when the file was never installed", async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error("ENOENT"));

      await expect(
        platform.uninstallHooks("/workspace"),
      ).resolves.not.toThrow();

      expect(fs.rmdir).not.toHaveBeenCalled();
    });
  });
});
