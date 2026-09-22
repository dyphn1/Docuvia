import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);

export default defineConfig({
  // ast-worker is built as its own entry (not just imported from cli.ts) so that
  // ast-worker-pool.ts's runtime `path.resolve(__dirname, "./ast-worker.js")` lookup finds a real
  // file sitting next to cli.js in dist/ — worker_threads needs an actual file to spawn, which a
  // single-bundle bundler output can never provide on its own.
  entry: {
    cli: "src/cli.ts",
    "ast-worker": "../../lib/core/src/ast/ast-worker.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  minify: true,
  sourcemap: true,
  outDir: "dist",
  // Several @workspace/* libs (contracts, core, git-local, remote-api, schema, ui-core) declare
  // "main": "./src/index.ts" with emitDeclarationOnly and ship no compiled .js — they're only
  // ever meant to be consumed by a bundler. tsup externalizes node_modules deps by default,
  // which leaves those raw .ts imports in dist/cli.js for plain `node` to choke on at runtime.
  noExternal: [/^@workspace\//],
  // ast-worker-pool.ts dynamically imports esbuild, but only on a code path (compiling a dev-mode
  // fallback worker) that's unreachable here: dist/ always ships its own pre-built ast-worker.js
  // (see the "ast-worker" entry above). Keep esbuild out of the shipped bundle entirely rather
  // than let it get silently inlined just because it happens to be resolvable via pnpm hoisting.
  external: ["esbuild"],
  // Bundling @workspace/* source pulls in transitive CJS deps (e.g. fast-glob) that call
  // require(...) internally. esbuild's ESM output has no ambient `require`, so without this
  // banner those calls hit esbuild's "Dynamic require of X is not supported" stub at runtime.
  esbuildOptions(options) {
    options.banner = {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    };
  },
  // web-tree-sitter's own bootstrap loads its core runtime wasm relative to wherever its
  // (bundled-in) code ends up executing — i.e. dist/, not its original node_modules location.
  // lib/schema's MIGRATIONS_DIR similarly resolves to `path.join(__dirname, "migrations")`,
  // assuming the .sql files sit next to the compiled JS. Bundling breaks both assumptions the
  // same way, so copy the real assets alongside the build output.
  onSuccess: async () => {
    const distDir = path.join(import.meta.dirname, "dist");
    const wasmSrc = require.resolve("web-tree-sitter/tree-sitter.wasm");
    fs.copyFileSync(wasmSrc, path.join(distDir, "tree-sitter.wasm"));

    const migrationsSrc = path.join(
      import.meta.dirname,
      "../../lib/schema/src/sqlite/migrations",
    );
    fs.cpSync(migrationsSrc, path.join(distDir, "migrations"), {
      recursive: true,
    });
  },
});
