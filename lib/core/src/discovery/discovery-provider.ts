import { IDiscoverableSourceFileProvider } from "@/contracts/interfaces/discovery.interfaces";
import { isDiscoverableSourceFile } from "@/core/discovery/discovery-constants";

export class DiscoverableSourceFileProvider implements IDiscoverableSourceFileProvider {
  isDiscoverableSourceFile(filePath: string): boolean {
    return isDiscoverableSourceFile(filePath);
  }
}
