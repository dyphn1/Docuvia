import { IDiscoverableSourceFileProvider } from "@workspace/contracts";
import { isDiscoverableSourceFile } from "../utils/language-detection.js";

export class DiscoverableSourceFileProvider implements IDiscoverableSourceFileProvider {
  isDiscoverableSourceFile(filePath: string): boolean {
    return isDiscoverableSourceFile(filePath);
  }
}
