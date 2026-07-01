import {
  IBuildArtifactParser,
  ParsedBuildArtifact,
  MemorySection,
  FirmwareModule,
} from "../../interfaces/build-artifact.interfaces.js";

export class MapParser implements IBuildArtifactParser {
  canParse(filename: string, content: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    return ext === "map";
  }

  parse(content: string, filename: string): ParsedBuildArtifact {
    const sections: MemorySection[] = [];

    // GCC ld map pattern: .section 0xADDRESS 0xSIZE
    const gccPattern = /^([.\w]+)\s+(0x[\da-f]+)\s+(0x[\da-f]+)/gim;
    let match: RegExpExecArray | null;
    while ((match = gccPattern.exec(content)) !== null) {
      const sizeHex = match[3];
      const size = parseInt(sizeHex, 16);
      if (size > 0) {
        sections.push({ name: match[1], address: match[2], size, sizeHex });
      }
    }

    // MSVC map public symbol pattern
    const msvcPattern = /^([0-9A-Fa-f]{4}):([0-9A-Fa-f]{8})\s+([.\w@?$]+)\s+([0-9A-Fa-f]{8})/gm;
    const msvcSymbols: MemorySection[] = [];
    while ((match = msvcPattern.exec(content)) !== null) {
      msvcSymbols.push({ name: match[3], address: `${match[1]}:${match[2]}` });
    }

    // Infer modules from .o file paths
    const modules: FirmwareModule[] = [];
    const objPattern = /[\w./\\-]+\.o\b/gi;
    const seen = new Set<string>();
    while ((match = objPattern.exec(content)) !== null) {
      const objFile = match[0];
      const parts = objFile.replace(/\\/g, "/").split("/");
      const moduleName = parts[parts.length - 1].replace(/\.o$/i, "");
      if (!seen.has(moduleName)) {
        seen.add(moduleName);
        modules.push({ name: moduleName });
      }
    }

    // Sort by size descending, keep top 20
    sections.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    const top20 = sections.slice(0, 20);

    const totalSize = sections.reduce((acc, s) => acc + (s.size ?? 0), 0);
    const largest = top20
      .slice(0, 2)
      .map((s) => `${s.name} (${Math.round((s.size ?? 0) / 1024)} KB)`)
      .join(", ");
    const summary = `Linker map with ${sections.length} sections. Largest: ${largest || "N/A"}. Total image size: ${Math.round(totalSize / 1024)} KB.`;

    return {
      subtype: "map",
      filename,
      sections: top20,
      modules: modules.slice(0, 20),
      diagnostics: [],
      metadata: {
        totalSections: String(sections.length),
        totalSizeKB: String(Math.round(totalSize / 1024)),
      },
      summary,
    };
  }
}
