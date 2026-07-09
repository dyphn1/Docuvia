import * as fs from "fs/promises";
import * as path from "path";
import { UTF8_ENCODING } from "@workspace/core";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

export async function writeOrAppend(filePath: string, content: string, marker: string) {
  try {
    const existing = await fs.readFile(filePath, UTF8_ENCODING);
    if (!existing.includes(marker)) {
      await fs.appendFile(filePath, `\n${content}`);
      ui.success(UI_MESSAGES.FS_APPENDED + filePath);
    } else {
      ui.info(UI_MESSAGES.FS_ALREADY_EXISTS + filePath);
    }
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    ui.success(UI_MESSAGES.FS_CREATED + filePath);
  }
}
