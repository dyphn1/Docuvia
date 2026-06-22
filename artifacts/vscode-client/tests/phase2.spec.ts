import { test, expect, ElectronApplication, Page } from "@playwright/test";
import * as fs from "fs";
import {
  launchVSCode,
  makeTempDataDir,
  openDocuviaSidebar,
  cleanupDocuviaDir,
  runInitProject,
  DOCUVIA_DIR,
} from "./helpers/launch";

test.describe("Phase 2: Dashboard Webview State", () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = makeTempDataDir();
    cleanupDocuviaDir();

    ({ electronApp, window } = await launchVSCode({
      userDataDir,
    }));

    await openDocuviaSidebar(window);

    // Initialize the project so the extension reaches isInitialized=true
    await runInitProject(window, "Test Project");

    // Wait for .docuvia folder to appear before opening Dashboard
    await expect.poll(() => fs.existsSync(DOCUVIA_DIR), { timeout: 12_000 }).toBe(true);

    // Open Dashboard via Command Palette
    await window.keyboard.press("Control+Shift+P");
    await window.waitForSelector(".quick-input-widget", { timeout: 10_000 });
    await window.keyboard.type("Docuvia: Open Dashboard");
    await window.keyboard.press("Enter");

    // Wait for the webview iframe to appear
    await window.waitForSelector("iframe.webview.ready", { timeout: 20_000 });
  });

  test.afterAll(async () => {
    cleanupDocuviaDir();
    if (electronApp) {
      await electronApp.close();
    }
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('Dashboard webview renders the "Docuvia Dashboard" header', async () => {
    const webviewFrame = window.frameLocator("iframe.webview.ready").last();
    const header = webviewFrame.locator("header");
    await expect(header).toContainText("Docuvia Dashboard", { timeout: 15_000 });
  });

  test("Dashboard stats show 0 tags, 0 modules, 0 decisions for empty .docuvia", async () => {
    const webviewFrame = window.frameLocator("iframe.webview.ready").last();
    await expect(webviewFrame.locator("#stat-tags")).toHaveText("0", { timeout: 15_000 });
    await expect(webviewFrame.locator("#stat-modules")).toHaveText("0", { timeout: 15_000 });
    await expect(webviewFrame.locator("#stat-decisions")).toHaveText("0", { timeout: 15_000 });
    await expect(webviewFrame.locator("#stat-pending")).toHaveText("0", { timeout: 15_000 });
    await expect(webviewFrame.locator("#stat-in-progress")).toHaveText("0", { timeout: 15_000 });
  });

  test("Dashboard shows the workspace name in the header", async () => {
    const webviewFrame = window.frameLocator("iframe.webview.ready").last();
    const workspaceName = webviewFrame.locator("#workspace-name");
    await expect(workspaceName).not.toBeEmpty({ timeout: 10_000 });
    await expect(workspaceName).toContainText("empty-workspace", { timeout: 10_000 });
  });

  test('Dashboard bottom bar shows the "Ask Docuvia..." chat button', async () => {
    const webviewFrame = window.frameLocator("iframe.webview.ready").last();
    const chatBtn = webviewFrame.locator("#open-chat-btn");
    await expect(chatBtn).toBeVisible({ timeout: 10_000 });
    await expect(chatBtn).toHaveText("Ask Docuvia\u2026");
  });

  test('Dashboard "Recent Decisions" list shows empty placeholder when no decisions exist', async () => {
    const webviewFrame = window.frameLocator("iframe.webview.ready").last();
    const emptyPlaceholder = webviewFrame.locator("#recent-decisions .empty");
    await expect(emptyPlaceholder).toBeVisible({ timeout: 10_000 });
    await expect(emptyPlaceholder).toContainText("No decisions yet.");
  });
});
