import path from "node:path";
import { ParsedAstFileResult } from "../interfaces/analyzer.interfaces.js";
import { ProcessedEvents } from "../types/ast-ingestion.types.js";

export function mapAstToEvents(results: ParsedAstFileResult[]): ProcessedEvents {
  const events: ProcessedEvents = {
    fileEvents: [],
    classEvents: [],
    functionEvents: [],
    importEvents: [],
    callEvents: [],
    contractEvents: [],
  };

  for (const { file, data } of results) {
    if (!data) {
      continue;
    }

    // File event
    events.fileEvents.push({
      filePath: file,
      baseName: path.basename(file),
      dirPath: path.dirname(file),
      l2Type: "module",
      pathPatterns: [],
    });

    // Class events
    for (const c of data.classes) {
      events.classEvents.push({
        name: c.name,
        fqn: `${file}::${c.name}`,
        filePath: file,
        l2NodeId: 0,
        nodeType: "rule",
      });
    }

    // Function events
    for (const fn of data.functions) {
      events.functionEvents.push({
        name: fn.name,
        fqn: `${file}::${fn.name}`,
        filePath: file,
        l2NodeId: 0,
        nodeType: "rule",
      });
    }

    // Import events
    for (const imp of data.imports) {
      events.importEvents.push({
        source: imp.modulePath,
        localName: imp.localName,
        importerFilePath: file,
      });
    }

    // Call events
    for (const call of data.calls) {
      events.callEvents.push({
        name: call.targetFunction,
        callerFilePath: file,
        isMethodCall: false,
      });
    }
  }

  return events;
}
