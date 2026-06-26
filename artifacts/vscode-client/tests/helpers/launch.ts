import { _electron as electron, ElectronApplication, Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function detectVSCodeExe(): string {
  const envPath = process.env.VSCODE_EXECUTABLE_PATH;
  if (envPath) return envPath;

  switch (process.platform) {
    case "darwin":
      return "/Applications/Visual Studio Code.app/Contents/MacOS/Electron";
    case "win32":
      return "D:\\VSCode\\Code.exe";
    case "linux":
      return "/usr/share/code/code";
    default:
      return "/usr/share/code/code";
  }
}

export const VSCODE_EXE = detectVSCodeExe();
export const EXTENSION_PATH = path.join(__dirname, "..", "..");
export const WORKSPACE_FIXTURE = path.join(EXTENSION_PATH, "tests", "fixtures", "empty-workspace");
export const DOCUVIA_DIR = path.join(WORKSPACE_FIXTURE, ".docuvia");

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
    "--new-window",
    "--no-sandbox",
    "--disable-gpu",
  ];

  const electronApp = await electron.launch({
    executablePath: VSCODE_EXE,
    args,
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector(".monaco-workbench", { timeout: 60_000 });

  return { electronApp, window };
}

/** Wait for the Docuvia Activity Bar icon and click it to open the sidebar. */
export async function openDocuviaSidebar(window: Page): Promise<void> {
  // VS Code renders activity-bar icons with aria-label from the viewsContainer name
  const icon = window.locator('.activitybar .action-item[aria-label*="ocuvia" i]');
  await icon.waitFor({ state: "visible", timeout: 30_000 });
  await icon.click();
  // Wait for the knowledge graph pane to appear
  await window.waitForSelector('.pane-header:has-text("Knowledge Graph")', {
    state: "attached",
    timeout: 15_000,
  });
}

/** Clean up the .docuvia directory created in the fixture workspace. */
export function cleanupDocuviaDir(): void {
  if (fs.existsSync(DOCUVIA_DIR)) {
    fs.rmSync(DOCUVIA_DIR, { recursive: true, force: true });
  }
}

function isMac(): boolean {
  return process.platform === "darwin";
}

/** Return the correct modifier key for VS Code command palette on this platform. */
export function cmdOrCtrl(): "Meta" | "Control" {
  return isMac() ? "Meta" : "Control";
}

/**
 * Initialize the empty-workspace fixture with a minimal git repo and sample files.
 * Required by the extension's initProject command (checks git status & ecosystem).
 */
export async function initFixture(): Promise<void> {
  const gitDir = path.join(WORKSPACE_FIXTURE, ".git");
  if (!fs.existsSync(gitDir)) {
    const { execSync } = require("child_process");
    execSync("git init", { cwd: WORKSPACE_FIXTURE });
    execSync('git config user.email "test@docuvia.dev"', { cwd: WORKSPACE_FIXTURE });
    execSync('git config user.name "Test"', { cwd: WORKSPACE_FIXTURE });
  }

  const readmePath = path.join(WORKSPACE_FIXTURE, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, "# Test Workspace\nA minimal fixture for E2E tests.");
  }

  const pkgPath = path.join(WORKSPACE_FIXTURE, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({ name: "empty-workspace", private: true }, null, 2));
  }

  // Ensure a git commit exists so git status passes in initProject
  const { execSync } = require("child_process");
  try {
    execSync("git add -A && git commit -m 'chore: initial commit for E2E tests'", {
      cwd: WORKSPACE_FIXTURE,
    });
  } catch {
    // Already committed or nothing to commit
  }
}

/**
 * Run "Docuvia: Init Project" via the Command Palette and supply a project name.
 * Leaves the .docuvia folder on disk ready for subsequent tests.
 */
export async function runInitProject(
  window: Page,
  projectName: string = "Test Project"
): Promise<void> {
  await window.keyboard.press(`${cmdOrCtrl()}+Shift+P`);
  await window.waitForSelector(".quick-input-widget", { timeout: 10_000 });
  await window.keyboard.type("Docuvia: Init Project");
  await window.keyboard.press("Enter");

  // Wait for command palette to close and showInputBox to appear
  await window.waitForTimeout(400);
  await window.waitForSelector(".quick-input-widget input", { timeout: 6_000 });
  await window.keyboard.press(`${cmdOrCtrl()}+A`);
  await window.keyboard.type(projectName);
  await window.keyboard.press("Enter");
}
