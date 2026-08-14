import { it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TestSandbox } from "../../support/sandbox.js";
import { GraphStore } from "@workspace/schema";

const execFileAsync = promisify(execFile);
const FIXTURE_FILES = {
  "package.json": JSON.stringify({ name: "fixture-project" }),
  "src/index.ts": "export function hello(): string {\n  return 'world';\n}\n",
};
const FIXTURE_NODE_KEY = "src/index.ts";

async function insertDecision(dbPath: string, input: { title: string; content: string; commitSha: string | null }): Promise<{ contentHash: string }> {
  const store = await GraphStore.open({ dbPath });
  try {
    const project = store.projects.getFirst();
    if (!project) throw new Error("no project");
    const l2NodeId = store.graph.findNodeIdByNodeKey(FIXTURE_NODE_KEY);
    if (l2NodeId === undefined) throw new Error("no l2");
    const result = store.l3.upsertDecision({
      projectId: project.id, l2NodeId,
      title: input.title, content: input.content,
      nodeType: "decision", confidence: 0.9,
      commitSha: input.commitSha, extractionModel: "test-model",
      sourceFiles: [FIXTURE_NODE_KEY],
    });
    const row = store.l3.getById(result.id)!;
    return { contentHash: row.content_hash! };
  } finally { await store.close(); }
}

it("debug sync logs", async () => {
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-debug-remote-"));
  await execFileAsync("git", ["init", "--bare", remoteDir]);

  const devA = new TestSandbox();
  await devA.setup({ initGit: true, files: FIXTURE_FILES });
  await devA.runGit(["add", "-A"]);
  await devA.runGit(["commit", "-m", "initial (A)"]);
  const { stdout: headShaA } = await devA.runGit(["rev-parse", "HEAD"]);
  await devA.runGit(["remote", "add", "origin", remoteDir]);
  await devA.runCli(["init"], { reject: false });
  const dbPathA = path.resolve(devA.dir, ".docuvia/local.db");
  await insertDecision(dbPathA, { title: "Decision A: named exports", content: "A's decision.", commitSha: headShaA.trim() });
  await devA.runCli(["snapshot"], { reject: false });
  await devA.runGit(["push", "origin", "HEAD"]);
  console.log("remote refs after devA push:", (await execFileAsync("git", ["for-each-ref", "--format=%(refname)"], { cwd: remoteDir })).stdout.trim().split("\n").filter(Boolean).join(","));

  const devB = new TestSandbox();
  await devB.setup({ initGit: true, files: FIXTURE_FILES });
  await devB.runGit(["add", "-A"]);
  await devB.runGit(["commit", "-m", "initial (B)"]);
  const { stdout: headShaB } = await devB.runGit(["rev-parse", "HEAD"]);
  await devB.runGit(["remote", "add", "origin", remoteDir]);
  await devB.runCli(["init"], { reject: false });
  const dbPathB = path.resolve(devB.dir, ".docuvia/local.db");
  await insertDecision(dbPathB, { title: "Decision B: named exports (independent)", content: "B's decision.", commitSha: headShaB.trim() });
  await devB.runCli(["snapshot"], { reject: false });

  const syncB = await devB.runCli(["sync-knowledge"], { reject: false });
  console.log("=== devB sync stdout ===");
  console.log(syncB.stdout || "");
  console.log("=== devB sync stderr (first 40 lines) ===");
  console.log((syncB.stderr || "").split("\n").filter(Boolean).slice(0, 40).join("\n"));

  const logPath = path.join(devB.dir, ".docuvia/logs/sync-knowledge.log");
  if (fs.existsSync(logPath)) {
    console.log("=== sync-knowledge.log ===");
    console.log(fs.readFileSync(logPath, "utf8"));
  } else {
    console.log("(no sync-knowledge.log at", logPath, ")");
  }
  console.log("=== remote refs after B sync ===", (await execFileAsync("git", ["for-each-ref", "--format=%(refname)"], { cwd: remoteDir })).stdout.trim().split("\n").filter(Boolean).join(","));
  console.log("B branch tip:", (await devB.runGit(["rev-parse", "docuvia-knowledge"])).stdout.trim());
});
