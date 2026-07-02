import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as sinon from "sinon";
import { KnowledgeStore } from "../knowledge-store.js";

suite("Phase 1: Local Knowledge Schema & Foundations", () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(vscode.window, "showInputBox").resolves("test-project");
    sandbox.stub(vscode.window, "showWarningMessage").resolves("Overwrite" as any);
    sandbox.stub(vscode.window, "showQuickPick").callsFake(async (items: any) => items[0]);
  });

  teardown(() => {
    sandbox.restore();
  });

  test("Extension should be present", () => {
    assert.ok(vscode.extensions.getExtension("docuvia.vscode-client"));
  });

  test("應該能執行 Docuvia: Init Project 並初始化 .docuvia 資料夾", async () => {
    // Arrange: Get the current workspace folder (our empty fixture)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    assert.ok(workspaceFolders && workspaceFolders.length > 0, "No workspace folder opened");
    const workspacePath = workspaceFolders[0].uri.fsPath;
    const docuviaPath = path.join(workspacePath, ".docuvia");

    // Ensure it's clean before test
    if (fs.existsSync(docuviaPath)) {
      fs.rmSync(docuviaPath, { recursive: true, force: true });
    }

    try {
      // Create a promise to wait for indexing to finish
      const indexingPromise = new Promise<void>((resolve) => {
        const disposable = KnowledgeStore.onDidFinishIndexing.event(() => {
          disposable.dispose();
          resolve();
        });
      });

      // Act: Execute the command and wait for it
      await vscode.commands.executeCommand("docuvia.initProject");
      await indexingPromise;

      // Assert: Verify the .docuvia folder and local.db were created
      assert.ok(fs.existsSync(docuviaPath), ".docuvia directory was not created");
      assert.ok(fs.existsSync(path.join(docuviaPath, "local.db")), "local.db was not created");
    } catch (error) {
      assert.fail(`Command execution failed: ${error}`);
    }
  });
});
