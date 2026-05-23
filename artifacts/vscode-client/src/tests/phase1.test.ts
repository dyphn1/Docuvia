import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('Phase 1: Local Knowledge Schema & Foundations', () => {
    
    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('docuvia.vscode-client'));
    });

    test('應該能執行 Docuvia: Init Project 並初始化 .docuvia 資料夾', async () => {
        // 1. Get the current workspace folder (our empty fixture)
        const workspaceFolders = vscode.workspace.workspaceFolders;
        assert.ok(workspaceFolders && workspaceFolders.length > 0, 'No workspace folder opened');
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const docuviaPath = path.join(workspacePath, '.docuvia');

        // Ensure it's clean before test
        if (fs.existsSync(docuviaPath)) {
            fs.rmSync(docuviaPath, { recursive: true, force: true });
        }

        // 2. Mock the QuickPick input for the project name (since we can't type via Playwright easily in standard tests)
        // Note: In real E2E, the extension should ideally accept arguments if called programmatically, 
        // or we mock the UI. Since we are testing if the command *works* and *creates files*,
        // we execute the command. If the command blocks waiting for UI input, we might need to 
        // temporarily stub the UI input during tests or provide a programmatic bypass.
        
        // For Phase 1 testing, let's trigger the command. 
        // If it hangs waiting for input, it means the command palette flow requires user interaction.
        // Let's see if the extension exposes a way to pass the name directly, otherwise we'll see a timeout.
        try {
             // In VS Code, executing a command programmatically that requires UI input might stall tests
             // Let's execute it.
             await vscode.commands.executeCommand('docuvia.initProject');
             
             // Wait a bit for file system operations
             await new Promise(resolve => setTimeout(resolve, 2000));

             // 3. Verify the .docuvia folder and config files were created
             assert.ok(fs.existsSync(docuviaPath), '.docuvia directory was not created');
             assert.ok(fs.existsSync(path.join(docuviaPath, 'l1_tags.yaml')), 'l1_tags.yaml was not created');
             
        } catch (error) {
            assert.fail(`Command execution failed: ${error}`);
        }
    });
});
