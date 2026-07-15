import * as fs from "fs/promises";
import * as path from "path";
import { UTF8_ENCODING } from "@workspace/contracts";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

export async function writeOrAppend(
  filePath: string,
  content: string,
  marker: string,
) {
  let existing: string | undefined;
  try {
    existing = await fs.readFile(filePath, UTF8_ENCODING);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      ui.warn(
        `${UI_MESSAGES.FS_READ_ERROR}${filePath} (${(err as NodeJS.ErrnoException).code ?? UI_MESSAGES.FS_READ_ERROR_UNKNOWN_CODE}); creating a new file instead of appending`,
      );
    }
  }

  if (existing === undefined) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    ui.success(UI_MESSAGES.FS_CREATED + filePath);
    return;
  }

  if (!existing.includes(marker)) {
    await fs.appendFile(filePath, `\n${content}`);
    ui.success(UI_MESSAGES.FS_APPENDED + filePath);
  } else {
    ui.info(UI_MESSAGES.FS_ALREADY_EXISTS + filePath);
  }
}

export async function createBackup(filePath: string): Promise<string | null> {
  try {
    const existing = await fs.readFile(filePath, UTF8_ENCODING);
    const backupPath = `${filePath}.bak`;
    await fs.writeFile(backupPath, existing, UTF8_ENCODING);
    return backupPath;
  } catch {
    return null;
  }
}

export async function removeBlock(
  filePath: string,
  startMarker: string,
  endMarker: string,
): Promise<boolean> {
  try {
    const existing = await fs.readFile(filePath, UTF8_ENCODING);
    const startIndex = existing.indexOf(startMarker);
    if (startIndex === -1) return false;

    const endIndex = existing.indexOf(endMarker, startIndex);
    if (endIndex === -1) return false;

    await createBackup(filePath);

    const before = existing.slice(0, startIndex);
    const after = existing.slice(endIndex + endMarker.length);
    await fs.writeFile(filePath, (before + after).trim() + "\n", UTF8_ENCODING);
    ui.success(
      `${UI_MESSAGES.FS_BLOCK_REMOVED_PREFIX}${filePath}${UI_MESSAGES.FS_BLOCK_REMOVED_SUFFIX}`,
    );
    return true;
  } catch {
    return false;
  }
}
