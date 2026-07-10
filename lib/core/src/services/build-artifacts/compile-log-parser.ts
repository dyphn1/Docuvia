import {
  IBuildArtifactParser,
  ParsedBuildArtifact,
  BuildDiagnostic,
} from "../../interfaces/build-artifact.interfaces.js";

export class CompileLogParser implements IBuildArtifactParser {
  canParse(_filename: string, _content: string): boolean {
    return true; // Fallback parser — always matches, must be registered last.
  }

  parse(content: string, filename: string): ParsedBuildArtifact {
    const diagnostics: BuildDiagnostic[] = [];
    const metadata: Record<string, string> = {};

    // GCC/Clang pattern: path/file.c:42:10: error: message
    const gccPattern = /^(.+?):(\d+):\d+:\s*(error|warning):\s*(.+)$/gim;
    let match: RegExpExecArray | null;
    while ((match = gccPattern.exec(content)) !== null) {
      const filePath = match[1].replace(/\\/g, "/");
      const segments = filePath.split("/");
      const module = segments.length > 1 ? segments[segments.length - 2] : undefined;
      diagnostics.push({
        severity: match[3].toLowerCase() as "error" | "warning",
        file: filePath,
        line: parseInt(match[2], 10),
        module,
        message: match[4].trim(),
      });
    }

    // MSVC pattern: path\file.cpp(42): error C2065: message
    const msvcPattern = /^(.+?)\((\d+)\):\s*(error|warning)\s+\w+:\s*(.+)$/gim;
    while ((match = msvcPattern.exec(content)) !== null) {
      const filePath = match[1].replace(/\\/g, "/");
      const segments = filePath.split("/");
      const module = segments.length > 1 ? segments[segments.length - 2] : undefined;
      diagnostics.push({
        severity: match[3].toLowerCase() as "error" | "warning",
        file: filePath,
        line: parseInt(match[2], 10),
        module,
        message: match[4].trim(),
      });
    }

    const totalErrors = diagnostics.filter((d) => d.severity === "error").length;
    const totalWarnings = diagnostics.filter((d) => d.severity === "warning").length;

    let buildStatus: "success" | "failed" | "unknown" = "unknown";
    if (/Build Successful/i.test(content)) buildStatus = "success";
    else if (/Build Failed|build error/i.test(content) || totalErrors > 0) buildStatus = "failed";

    const modules = new Set(diagnostics.map((d) => d.module).filter(Boolean));

    metadata["totalErrors"] = String(totalErrors);
    metadata["totalWarnings"] = String(totalWarnings);
    metadata["buildStatus"] = buildStatus;

    const summary = `Build log: ${totalErrors} errors, ${totalWarnings} warnings across ${modules.size} modules. Status: ${buildStatus}.`;

    return {
      subtype: "compile-log",
      filename,
      sections: [],
      modules: [],
      diagnostics: diagnostics.slice(0, 50),
      metadata,
      summary,
    };
  }
}
