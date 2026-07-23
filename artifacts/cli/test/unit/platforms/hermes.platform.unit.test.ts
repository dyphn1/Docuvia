import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import { HermesPlatform } from "../../../src/platforms/hermes.platform.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
} from "../../../src/constants/init-templates.js";
import { writeOrAppend, removeBlock } from "../../../src/utils/fs-utils.js";

vi.mock("../../../src/utils/fs-utils.js", () => ({
  writeOrAppend: vi.fn(),
  removeBlock: vi.fn(),
}));

describe("HermesPlatform", () => {
  let platform: HermesPlatform;

  beforeEach(() => {
    vi.clearAllMocks();
    platform = new HermesPlatform();
  });

  it("writes the instructions block into the repo-root .hermes.md", async () => {
    await platform.installHooks("/workspace");

    expect(writeOrAppend).toHaveBeenCalledWith(
      path.join("/workspace", ".hermes.md"),
      AGENT_INSTRUCTIONS,
      AGENT_INSTRUCTIONS_MARKER,
    );
  });

  it("removes only its own marker block on uninstall", async () => {
    await platform.uninstallHooks("/workspace");

    expect(removeBlock).toHaveBeenCalledWith(
      path.join("/workspace", ".hermes.md"),
      "<!-- docuvia:start -->",
      "<!-- docuvia:end -->",
    );
  });
});
