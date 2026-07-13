import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { docuviaApi } from "@workspace/ui-core";
import { exportTopologyCommand } from "../../../src/commands/export-topology.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { exportTopology: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockExportTopology = vi.mocked(docuviaApi.exportTopology);

const sampleGraph = {
  topologyVersion: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  workspaceRoot: "/workspace/demo",
  collapsed: false,
  nodes: [],
  links: [],
  groups: [],
  stats: { nodeCount: 0, linkCount: 0, groupCount: 0 },
};

describe("exportTopologyCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-export-topology-cli-"),
    );
    mockExportTopology.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes topology.json and topology.html under .docuvia by default", async () => {
    mockExportTopology.mockResolvedValue(sampleGraph);

    await exportTopologyCommand({}, tmpDir);

    const jsonPath = path.join(tmpDir, ".docuvia", "topology.json");
    const htmlPath = path.join(tmpDir, ".docuvia", "topology.html");
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual(sampleGraph);
    expect(fs.readFileSync(htmlPath, "utf8")).toContain("<!DOCTYPE html>");
    expect(spinnerSucceed).toHaveBeenCalled();
  });

  it("skips topology.html when jsonOnly is set", async () => {
    mockExportTopology.mockResolvedValue(sampleGraph);

    await exportTopologyCommand({ jsonOnly: true }, tmpDir);

    expect(fs.existsSync(path.join(tmpDir, ".docuvia", "topology.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, ".docuvia", "topology.html"))).toBe(
      false,
    );
  });

  it("writes into a custom output directory when out is given", async () => {
    mockExportTopology.mockResolvedValue(sampleGraph);
    const outDir = path.join(tmpDir, "custom-out");

    await exportTopologyCommand({ out: outDir }, tmpDir);

    expect(fs.existsSync(path.join(outDir, "topology.json"))).toBe(true);
  });

  it("calls spinner.fail when docuviaApi.exportTopology() throws", async () => {
    mockExportTopology.mockRejectedValue(new Error("boom"));

    await exportTopologyCommand({}, tmpDir);

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(process.exitCode).toBe(1);
  });
});
