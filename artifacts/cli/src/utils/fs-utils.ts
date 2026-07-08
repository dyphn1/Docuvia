import * as fs from "fs/promises";
import * as path from "path";
import { ui } from "../ui/wizard.js";

export async function writeOrAppend(filePath: string, content: string, marker: string) {
  try {
    const existing = await fs.readFile(filePath, "utf8");
    if (!existing.includes(marker)) {
      await fs.appendFile(filePath, `\n${content}`);
      ui.success(`Appended instructions to: ${filePath}`);
    } else {
      ui.info(`Instructions already exist in: ${filePath}`);
    }
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    ui.success(`Created: ${filePath}`);
  }
}
