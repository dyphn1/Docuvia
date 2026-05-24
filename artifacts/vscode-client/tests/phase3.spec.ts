import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import {
  launchVSCode,
  makeTempDataDir,
  cleanupDocuviaDir,
  runInitProject,
  DOCUVIA_DIR,
} from './helpers/launch';

test.describe('Phase 3: Chat Interaction (@docuvia)', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = makeTempDataDir();
    cleanupDocuviaDir();

    ({ electronApp, window } = await launchVSCode({
      userDataDir,
    }));

    // Initialize project so the extension is active with .docuvia
    await runInitProject(window, 'Test Project');
    await expect.poll(() => fs.existsSync(DOCUVIA_DIR), { timeout: 12_000 }).toBe(true);
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

  async function openChatPanel(): Promise<void> {
    await window.keyboard.press('Control+Shift+P');
    await window.waitForSelector('.quick-input-widget', { timeout: 10_000 });
    await window.keyboard.type('Chat: Open Chat');
    await window.keyboard.press('Enter');

    // Wait for the chat input to become visible
    const chatInput = window.locator('.interactive-input-editor .view-line').first();
    await chatInput.waitFor({ state: 'visible', timeout: 20_000 });
  }

  async function sendChatMessage(message: string): Promise<void> {
    const chatInput = window.locator('.interactive-input-editor .view-line').first();
    await chatInput.click();
    await window.keyboard.type(message);
    await window.keyboard.press('Enter');
  }

  test('@docuvia /help shows help table with all supported commands', async () => {
    await openChatPanel();
    await sendChatMessage('@docuvia /help');

    const chatResponse = window.locator('.interactive-item-container').last();
    await chatResponse.waitFor({ state: 'visible', timeout: 30_000 });

    await expect(chatResponse).toContainText('/explore', { timeout: 30_000 });
    await expect(chatResponse).toContainText('/query');
    await expect(chatResponse).toContainText('/extract');
    await expect(chatResponse).toContainText('/help');
  });

  test('@docuvia /explore responds with project type detection', async () => {
    await sendChatMessage('@docuvia /explore');

    const chatResponse = window.locator('.interactive-item-container').last();
    await chatResponse.waitFor({ state: 'visible', timeout: 30_000 });

    // The fixture has no README.md or package.json so the fallback message is shown
    const hasFrontend = await chatResponse.locator('text=frontend').count();
    const hasBackend = await chatResponse.locator('text=backend').count();
    const hasCantDetect = await chatResponse.locator("text=couldn't detect").count();
    const hasReadingFiles = await chatResponse.locator('text=Reading workspace files').count();

    expect(hasFrontend + hasBackend + hasCantDetect + hasReadingFiles).toBeGreaterThan(0);
  });

  test('@docuvia /query nonexistent-term returns no-results message', async () => {
    await sendChatMessage('@docuvia /query nonexistent-term-zzz');

    const chatResponse = window.locator('.interactive-item-container').last();
    await chatResponse.waitFor({ state: 'visible', timeout: 30_000 });

    await expect(chatResponse).toContainText('No local results found for', { timeout: 30_000 });
    await expect(chatResponse).toContainText('nonexistent-term-zzz');
  });
});
