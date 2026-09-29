import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PACKAGE_NAME = "typescript-language-server";
const BIN_NAME = PACKAGE_NAME;

interface PackageManifest {
  readonly bin?: string | Readonly<Record<string, string>>;
}

/** Resolves the package's JavaScript entry instead of its platform-specific .bin shim. */
export function typescriptLanguageServerEntry(): string {
  const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
  const packageJson = requireFromRoot.resolve(`${PACKAGE_NAME}/package.json`);
  const manifest = requireFromRoot(packageJson) as PackageManifest;
  const bin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[BIN_NAME];
  if (!bin)
    throw new Error(`${PACKAGE_NAME} has no ${BIN_NAME} package bin entry`);
  return path.resolve(path.dirname(packageJson), bin);
}
