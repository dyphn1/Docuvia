export interface IDiscoverableSourceFileProvider {
  isDiscoverableSourceFile(filePath: string): boolean;
}
