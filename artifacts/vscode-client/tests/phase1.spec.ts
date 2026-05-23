import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Phase 1: Local Knowledge Schema & Foundations', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    const extensionPath = path.join(__dirname, '..');
    
    // Playwright downloads its own Node.js/Electron environment for testing VS Code extensions if configured right, 
    // but for true e2e with VS Code, we can launch the VS Code binary.
    // However, it's more stable to use the official @vscode/test-electron or playwright-vscode approach.
    // For now, let's use the local VS Code binary path.
    const vscodeExecutablePath = 'D:\\VSCode\\Code.exe';

    electronApp = await electron.launch({
      executablePath: vscodeExecutablePath,
      args: [
        '--disable-extensions',
        `--extensionDevelopmentPath=${extensionPath}`,
        // Open a specific test workspace folder so we have a clean slate
        path.join(extensionPath, 'tests', 'fixtures', 'empty-workspace'),
        '--new-window',
        '--no-sandbox'
      ]
    });

    window = await electronApp.firstWindow();
    await window.waitForSelector('.monaco-workbench');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('應該能執行 Docuvia: Init Project 並初始化 .docuvia 資料夾', async () => {
    // 1. 開啟 Command Palette
    await window.keyboard.press('Control+Shift+P');
    
    // 2. 輸入並執行指令
    await window.keyboard.type('Docuvia: Init Project');
    await window.keyboard.press('Enter');

    // 3. 處理可能跳出的 prompt (例如詢問專案名稱)
    // 假設擴充功能會要求輸入專案名稱
    await window.waitForSelector('.quick-input-widget');
    await window.keyboard.type('Test Project');
    await window.keyboard.press('Enter');

    // 4. 驗證 UI 狀態改變: 
    // "Welcome to Docuvia" 應該消失，TreeView 應該出現
    const welcomeView = window.locator('text="Welcome to Docuvia!"');
    await expect(welcomeView).not.toBeVisible({ timeout: 10000 });
  });
});
