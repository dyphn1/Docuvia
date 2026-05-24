import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const VSCODE_EXE = 'D:\\VSCode\\Code.exe';
export const EXTENSION_PATH = path.join(__dirname, '..', '..');
export const WORKSPACE_FIXTURE = path.join(EXTENSION_PATH, 'tests', 'fixtures', 'empty-workspace');
export const DOCUVIA_DIR = path.join(WORKSPACE_FIXTURE, '.docuvia');

/** Create a fresh temporary VS Code user-data dir for this test run. */
export function makeTempDataDir(): string {
  const dir = path.join(os.tmpdir(), `docuvia-test-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Launch a VS Code Electron instance with the Docuvia extension loaded. */
export async function launchVSCode(opts: {
  userDataDir: string;
}): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const args: string[] = [
    `--extensionDevelopmentPath=${EXTENSION_PATH}`,
    `--user-data-dir=${opts.userDataDir}`,
    WORKSPACE_FIXTURE,
    '--new-window',
    '--no-sandbox',
    '--disable-gpu',
  ];

  const electronApp = await electron.launch({
    executablePath: VSCODE_EXE,
    args,
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });

  return { electronApp, window };
}

/** Wait for the Docuvia Activity Bar icon and click it to open the sidebar. */
export async function openDocuviaSidebar(window: Page): Promise<void> {
  const icon = window.locator('.activitybar .action-item[aria-label="Docuvia"]');
  await icon.waitFor({ state: 'visible', timeout: 15_000 });
  await icon.click();
  await window.waitForSelector('.pane-header[aria-label*="Knowledge Graph"]', {
    state: 'attached',
    timeout: 10_000,
  });
}

/** Clean up the .docuvia directory created in the fixture workspace. */
export function cleanupDocuviaDir(): void {
  if (fs.existsSync(DOCUVIA_DIR)) {
    fs.rmSync(DOCUVIA_DIR, { recursive: true, force: true });
  }
}

/**
 * Run "Docuvia: Init Project" via the Command Palette and supply a project name.
 * Leaves the .docuvia folder on disk ready for subsequent tests.
 */
export async function runInitProject(window: Page, projectName: string = 'Test Project'): Promise<void> {
  await window.keyboard.press('Control+Shift+P');
  await window.waitForSelector('.quick-input-widget', { timeout: 10_000 });
  await window.keyboard.type('Docuvia: Init Project');
  await window.keyboard.press('Enter');

  // Wait for command palette to close and showInputBox to appear
  await window.waitForTimeout(400);
  await window.waitForSelector('.quick-input-widget input', { timeout: 6_000 });
  await window.keyboard.press('Control+A');
  await window.keyboard.type(projectName);
  await window.keyboard.press('Enter');
}
