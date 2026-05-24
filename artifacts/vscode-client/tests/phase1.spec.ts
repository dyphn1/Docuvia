import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  launchVSCode,
  makeTempDataDir,
  openDocuviaSidebar,
  cleanupDocuviaDir,
  DOCUVIA_DIR,
} from './helpers/launch';

test.describe('Phase 1: Local Knowledge Schema & Foundations', () => {
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

  test('Welcome View is visible when .docuvia folder does not exist', async () => {
    const welcomeView = window.locator('.view-welcome-content', { hasText: 'Welcome to Docuvia!' });
    await expect(welcomeView).toBeVisible({ timeout: 10_000 });
  });

  test('Docuvia: Init Project creates .docuvia directory with skeleton YAML files', async () => {
    expect(fs.existsSync(DOCUVIA_DIR)).toBe(false);

    await window.keyboard.press('Control+Shift+P');
    await window.waitForSelector('.quick-input-widget', { timeout: 10_000 });
    await window.keyboard.type('Docuvia: Init Project');
    await window.keyboard.press('Enter');

    await window.waitForTimeout(400);
    await window.waitForSelector('.quick-input-widget input', { timeout: 6_000 });
    await window.keyboard.press('Control+A');
    await window.keyboard.type('Test Project');
    await window.keyboard.press('Enter');

    await expect.poll(() => fs.existsSync(DOCUVIA_DIR), { timeout: 12_000 }).toBe(true);
    await expect.poll(
      () => fs.existsSync(path.join(DOCUVIA_DIR, 'l1_tags.yaml')),
      { timeout: 12_000 }
    ).toBe(true);
    await expect.poll(
      () => fs.existsSync(path.join(DOCUVIA_DIR, 'l2_modules.yaml')),
      { timeout: 12_000 }
    ).toBe(true);
    await expect.poll(
      () => fs.existsSync(path.join(DOCUVIA_DIR, 'l3_router.yaml')),
      { timeout: 12_000 }
    ).toBe(true);
    await expect.poll(
      () => fs.existsSync(path.join(DOCUVIA_DIR, 'l3_decisions')),
      { timeout: 12_000 }
    ).toBe(true);
    await expect.poll(
      () => fs.statSync(path.join(DOCUVIA_DIR, 'l3_decisions')).isDirectory(),
      { timeout: 12_000 }
    ).toBe(true);
    await expect.poll(
      () => fs.readFileSync(path.join(DOCUVIA_DIR, 'l1_tags.yaml'), 'utf-8').includes('Test Project'),
      { timeout: 12_000 }
    ).toBe(true);
  });

  test('Welcome View disappears after .docuvia folder is created', async () => {
    const welcomeView = window.locator('.view-welcome-content', { hasText: 'Welcome to Docuvia!' });
    await expect(welcomeView).not.toBeVisible({ timeout: 12_000 });
  });

  test('Knowledge Graph TreeView is visible after initialization', async () => {
    const treeViewPane = window.locator('.pane-body[aria-label*="Knowledge Graph"]');
    await expect(treeViewPane).toBeVisible({ timeout: 10_000 });
  });
});
