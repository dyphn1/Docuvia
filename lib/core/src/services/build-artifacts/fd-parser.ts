import {
  IBuildArtifactParser,
  ParsedBuildArtifact,
  MemorySection,
} from "../../interfaces/build-artifact.interfaces.js";

export class FdParser implements IBuildArtifactParser {
  canParse(filename: string, content: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "fd") return true;
    return /\[FD\./i.test(content);
  }

  parse(content: string, filename: string): ParsedBuildArtifact {
    const sections: MemorySection[] = [];
    const metadata: Record<string, string> = {};

    // FD header
    const fdHeaderMatch = content.match(/^\[FD\.(\w+)\]/im);
    const fdName = fdHeaderMatch ? fdHeaderMatch[1] : filename;
    metadata["FdName"] = fdName;

    // BaseAddress and Size
    const baseMatch = content.match(/^BaseAddress\s*=\s*(0x[\da-fA-F]+)/im);
    if (baseMatch) metadata["BaseAddress"] = baseMatch[1];

    const sizeMatch = content.match(/^Size\s*=\s*(0x[\da-fA-F]+)/im);
    if (sizeMatch) {
      metadata["Size"] = sizeMatch[1];
      const sizeBytes = parseInt(sizeMatch[1], 16);
      metadata["SizeMB"] = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    // Flash regions: 0xOFFSET|0xSIZE
    const regionPattern = /^(0x[\da-fA-F]+)\|(0x[\da-fA-F]+)/gim;
    let match: RegExpExecArray | null;
    let regionIdx = 0;
    while ((match = regionPattern.exec(content)) !== null) {
      const address = match[1];
      const sizeHex = match[2];
      const size = parseInt(sizeHex, 16);
      sections.push({ name: `Region${regionIdx++}`, address, size, sizeHex });
    }

    // FV references in regions
    const fvRefPattern = /FILE\s*=\s*.+\/(FV\w+)\.fv/gim;
    const fvNames: string[] = [];
    while ((match = fvRefPattern.exec(content)) !== null) {
      fvNames.push(match[1]);
    }
    if (fvNames.length > 0) metadata["FirmwareVolumes"] = fvNames.join(", ");

    const summary = `Flash Descriptor [${fdName}]: BaseAddress=${metadata["BaseAddress"] ?? "unknown"}, Size=${metadata["SizeMB"] ?? "unknown"}. ${sections.length} flash regions (${fvNames.slice(0, 3).join(", ") || "N/A"}).`;

    return {
      subtype: "fd",
      filename,
      sections,
      modules: [],
      diagnostics: [],
      metadata,
      summary,
    };
  }
}
