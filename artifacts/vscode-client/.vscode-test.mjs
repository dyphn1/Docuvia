import { defineConfig } from "@vscode/test-cli";
import * as path from "path";
import * as url from "url";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

export default defineConfig([
  {
    label: "e2e",
    files: "out/tests/**/*.test.js",
    version: "insiders",
    workspaceFolder: path.join(__dirname, "tests", "fixtures", "empty-workspace"),
    mocha: {
      ui: "tdd",
      timeout: 60000,
    },
  },
]);
