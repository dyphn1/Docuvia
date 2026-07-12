import { describe, it, expect, vi, beforeEach } from "vitest";
import { CursorPlatform } from "../../../src/platforms/cursor.platform.js";
import * as fs from "fs/promises";
import * as path from "path";
import { ui } from "../../../src/ui/wizard.js";

import { HOOKS_JSON } from "../../../src/constants/init-templates.js";

vi.mock("fs/promises");
vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../../src/utils/fs-utils.js", () => ({
  writeOrAppend: vi.fn(),
  removeBlock: vi.fn(),
}));

describe("CursorPlatform", () => {
  let platform: CursorPlatform;

  beforeEach(() => {
    vi.clearAllMocks();
    platform = new CursorPlatform();
  });

  describe("installHooks", () => {
    it("creates directories and files for cursor hooks", async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: {} }),
      );

      await platform.installHooks("/workspace");

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join("/workspace", ".cursor", "hooks"),
        { recursive: true },
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join("/workspace", ".cursor", "hooks", "docuvia-hook.cjs"),
        expect.any(String),
        { mode: 0o755 },
      );
    });

    it("configures MCP server successfully", async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: {} }),
      );

      await platform.installHooks("/workspace");

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join("/workspace", ".cursor", "mcp.json"),
        expect.stringContaining("docuvia"),
      );
      expect(ui.success).toHaveBeenCalled();
    });

    it("handles missing MCP config file by creating it", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await platform.installHooks("/workspace");

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join("/workspace", ".cursor"),
        { recursive: true },
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join("/workspace", ".cursor", "mcp.json"),
        expect.stringContaining("docuvia"),
      );
    });

    it("warns if MCP configuration fails entirely", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockImplementation((filePath) => {
        if (filePath.toString().includes("mcp.json")) {
          return Promise.reject(new Error("Permission denied"));
        }
        return Promise.resolve(undefined);
      });

      await platform.installHooks("/workspace");

      expect(ui.warn).toHaveBeenCalledWith(
        expect.stringContaining("Permission denied"),
      );
    });
  });

  describe("uninstallHooks", () => {
    it("removes hook files", async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error("not found"));

      await platform.uninstallHooks("/workspace");

      expect(fs.unlink).toHaveBeenCalledWith(
        path.join("/workspace", ".cursor", "hooks", "docuvia-hook.cjs"),
      );
      expect(ui.success).toHaveBeenCalledWith(
        expect.stringContaining("Removed"),
      );
    });

    it("removes hooks.json and rmdir if content matches", async () => {
      const hooksJsonContent = HOOKS_JSON.replace(
        /\$\{HOOKS_DIR\}/g,
        "${CURSOR_PLUGIN_ROOT}/hooks",
      ).replace(".js", ".cjs");

      vi.mocked(fs.readFile).mockResolvedValue(hooksJsonContent);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.rmdir).mockResolvedValue(undefined);

      await platform.uninstallHooks("/workspace");
    });

    it("handles rmdir failure gracefully", async () => {
      const hooksJsonContent = HOOKS_JSON.replace(
        /\$\{HOOKS_DIR\}/g,
        "${CURSOR_PLUGIN_ROOT}/hooks",
      ).replace(".js", ".cjs");

      vi.mocked(fs.readFile).mockResolvedValue(hooksJsonContent);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.rmdir).mockRejectedValue(new Error("ENOTEMPTY"));

      await platform.uninstallHooks("/workspace");
      expect(fs.rmdir).toHaveBeenCalled();
    });

    it("skips hooks.json removal if content mismatches", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("different content");
      await platform.uninstallHooks("/workspace");
      expect(fs.rmdir).not.toHaveBeenCalled();
    });

    it("removes MCP server from config", async () => {
      const mcpContent = JSON.stringify({
        mcpServers: {
          "docuvia-local": { command: "npx" },
        },
      });
      // Important: fs.readFile is called multiple times in uninstallHooks (for hooks.json and mcp.json).
      // We must make sure it returns the correct content for mcp.json.
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath.toString().includes("mcp.json")) {
          return mcpContent;
        }
        throw new Error("not found");
      });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await platform.uninstallHooks("/workspace");

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join("/workspace", ".cursor", "mcp.json"),
        expect.stringMatching(/{\s*"mcpServers":\s*{}\s*}/),
      );
      expect(ui.success).toHaveBeenCalledWith(
        expect.stringContaining("Removed MCP server"),
      );
    });
  });
});
