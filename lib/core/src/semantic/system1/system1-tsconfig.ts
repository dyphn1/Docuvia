import path from "node:path";
import ts from "typescript";
import { SYSTEM1_IGNORABLE_TSCONFIG_DIAGNOSTIC_CODES } from "./system1-constants.js";

interface SnapshotFileSystemEntries {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

interface TypeScriptMatchFiles {
  (
    rootDir: string,
    extensions: readonly string[] | undefined,
    excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined,
    useCaseSensitiveFileNames: boolean,
    currentDirectory: string,
    depth: number | undefined,
    getFileSystemEntries: (directory: string) => SnapshotFileSystemEntries,
    realpath: (fileName: string) => string,
  ): string[];
}

export interface System1ProjectOptions {
  readonly options: ts.CompilerOptions;
  readonly parsed: boolean;
}

export interface System1SnapshotConfigInput {
  readonly configPath: string;
  readonly snapshotRoot: string;
  readonly trackedFiles: ReadonlySet<string>;
  readonly readText: (file: string) => string | undefined;
}

/** Parses JSONC TypeScript configuration while exposing only tracked snapshot files. */
export function parseSystem1ProjectOptions(
  input: System1SnapshotConfigInput,
): System1ProjectOptions {
  const snapshotPath = (fileName: string): string | undefined => {
    const absolutePath = path.resolve(fileName);
    const relativePath = path.relative(input.snapshotRoot, absolutePath);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    )
      return undefined;
    return relativePath.split(path.sep).join("/");
  };
  const readFile = (fileName: string): string | undefined => {
    const relativePath = snapshotPath(fileName);
    if (!relativePath || !input.trackedFiles.has(relativePath))
      return undefined;
    return input.readText(relativePath);
  };
  const fileExists = (fileName: string): boolean => {
    const relativePath = snapshotPath(fileName);
    return relativePath !== undefined && input.trackedFiles.has(relativePath);
  };
  const fileSystemEntries = (
    directoryName: string,
  ): SnapshotFileSystemEntries => {
    const relativeDirectory = snapshotPath(directoryName);
    if (relativeDirectory === undefined) return { files: [], directories: [] };
    const prefix = relativeDirectory
      ? `${relativeDirectory.replace(/\/$/, "")}/`
      : "";
    const files: string[] = [];
    const directories = new Set<string>();
    for (const trackedFile of input.trackedFiles) {
      if (!trackedFile.startsWith(prefix)) continue;
      const remainder = trackedFile.slice(prefix.length);
      const slash = remainder.indexOf("/");
      if (slash < 0) {
        files.push(remainder);
      } else {
        directories.add(remainder.slice(0, slash));
      }
    }
    return { files, directories: [...directories] };
  };
  const readDirectory: ts.ParseConfigHost["readDirectory"] = (
    rootDir,
    extensions,
    excludes,
    includes,
    depth,
  ) =>
    (ts as unknown as { matchFiles: TypeScriptMatchFiles }).matchFiles(
      rootDir,
      extensions,
      excludes,
      includes,
      true,
      input.snapshotRoot,
      depth,
      fileSystemEntries,
      (fileName) => fileName,
    );
  const configHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists,
    readFile,
    readDirectory,
  };
  const configFile = ts.readConfigFile(input.configPath, readFile);
  if (configFile.error) return { options: {}, parsed: false };
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    configHost,
    path.dirname(input.configPath),
    undefined,
    input.configPath,
  );
  return {
    options: parsed.options,
    parsed: parsed.errors.every((diagnostic) =>
      SYSTEM1_IGNORABLE_TSCONFIG_DIAGNOSTIC_CODES.includes(
        diagnostic.code as (typeof SYSTEM1_IGNORABLE_TSCONFIG_DIAGNOSTIC_CODES)[number],
      ),
    ),
  };
}
