import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import { CodexPlatform } from "../../../src/platforms/codex.platform.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
} from "../../../src/constants/init-templates.js";
import { writeOrAppend, removeBlock } from "../../../src/utils/fs-utils.js";

vi.mock("../../../src/utils/fs-utils.js", () => ({
  writeOrAppend: vi.fn(),
  removeBlock: vi.fn(),
}));

describe("CodexPlatform", () => {
  let platform: CodexPlatform;

  beforeEach(() => {
    vi.clearAllMocks();
    platform = new CodexPlatform();
  });

  it("writes the instructions block into the repo-root AGENTS.md", async () => {
    await platform.installHooks("/workspace");

    expect(writeOrAppend).toHaveBeenCalledWith(
      path.join("/workspace", "AGENTS.md"),
      AGENT_INSTRUCTIONS,
      AGENT_INSTRUCTIONS_MARKER,
    );
  });

  it("removes only its own marker block on uninstall, never the rest of AGENTS.md", async () => {
    await platform.uninstallHooks("/workspace");

    expect(removeBlock).toHaveBeenCalledWith(
      path.join("/workspace", "AGENTS.md"),
      "<!-- docuvia:start -->",
      "<!-- docuvia:end -->",
    );
  });
});
