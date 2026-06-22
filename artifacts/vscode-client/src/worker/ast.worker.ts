import {
  generateAst,
  initParser,
  ParsingFunnel,
  LanguageRegistry,
  DefaultProvider,
} from "@workspace/ast-core";
import { IpcSqliteSink } from "../ast/ipc-sqlite-sink.js";

let registry: LanguageRegistry;

let isParserInit = false;

async function ensureParserInit() {
  if (isParserInit) return;
  registry = await LanguageRegistry.load();
  await initParser((scriptName: string) => {
    return "../wasm/" + scriptName;
  });
  isParserInit = true;
}

(globalThis as any).addEventListener("message", async (e: MessageEvent) => {
  const { type, filePath, content, language } = e.data;
  if (type === "parse") {
    try {
      await ensureParserInit();

      const sink = new IpcSqliteSink();
      const funnel = new ParsingFunnel(registry);

      let actualContent = content;
      if (actualContent === undefined) {
        try {
          const fs = await import("fs/promises");
          actualContent = await fs.readFile(filePath, "utf8");
        } catch (readErr) {
          throw new Error(`Failed to read file ${filePath}: ${readErr}`);
        }
      }

      let ext = filePath.includes(".") ? "." + filePath.split(".").pop() : "";

      // Ensure language provider is available if language is passed.
      if (language && !registry.getProviderForExtension(ext)) {
        registry.registerProvider(
          [ext],
          new DefaultProvider({
            extensions: [ext],
            wasm_file: language.wasmPath,
            imports: language.imports || [],
            classes: language.classes || [],
            functions: language.functions || [],
            calls: language.calls || [],
            queries: language.queries || {
              classes: "",
              functions: "",
              imports: "",
              calls: "",
            },
          })
        );
      }

      const funnelResult = funnel.process(actualContent, filePath, ext);
      if (!funnelResult.accepted) {
        (globalThis as any).postMessage({
          type: "error",
          error: "File rejected by parsing funnel: " + funnelResult.reason,
          filePath,
        });
        return;
      }

      ext = funnelResult.mappedExtension || ext;

      const loadWasm = async (wasmFileName: string) => {
        const res = await fetch("../wasm/" + wasmFileName);
        if (!res.ok) throw new Error(`Failed to load ${wasmFileName}`);
        return await res.arrayBuffer();
      };

      for await (const event of generateAst(actualContent, filePath, ext, registry, loadWasm)) {
        sink.emit(event);
      }

      await sink.flush();
      (globalThis as any).postMessage({ type: "done", filePath });
    } catch (err: any) {
      (globalThis as any).postMessage({ type: "error", error: err.message, filePath });
    }
  }
});
