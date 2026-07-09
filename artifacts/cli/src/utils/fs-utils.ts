import * as fs from "fs/promises";
import * as path from "path";
import { ui } from "../ui/wizard.js";
import { FS_MESSAGES } from "../constants/fs-messages.js";
import { UTF8_ENCODING } from "../constants/encoding.js";

export async function writeOrAppend(filePath: string, content: string, marker: string) {
  try {
    const existing = await fs.readFile(filePath, UTF8_ENCODING);
    if (!existing.includes(marker)) {
      await fs.appendFile(filePath, `\n${content}`);
      ui.success(FS_MESSAGES.APPENDED(filePath));
    } else {
      ui.info(FS_MESSAGES.ALREADY_EXISTS(filePath));
    }
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    ui.success(FS_MESSAGES.CREATED(filePath));
  }
}
