import {
  IBuildArtifactParser,
  ParsedBuildArtifact,
  FirmwareModule,
} from "../../interfaces/build-artifact.interfaces.js";

export class FvParser implements IBuildArtifactParser {
  canParse(filename: string, content: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "fv") return true;
    return /DEFINE FV_NAMESPACE|\[FV\./i.test(content);
  }

  parse(content: string, filename: string): ParsedBuildArtifact {
    const modules: FirmwareModule[] = [];
    const metadata: Record<string, string> = {};

    // FV section header
    const fvHeaderMatch = content.match(/^\[FV\.(\w+)\]/im);
    const fvName = fvHeaderMatch ? fvHeaderMatch[1] : filename;

    // Metadata key=value within FV block
    const metaPattern = /^(\w+)\s*=\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = metaPattern.exec(content)) !== null) {
      const key = match[1];
      if (["FvAlignment", "FvSize", "BaseAddress", "BlockSize", "NumBlocks"].includes(key)) {
        metadata[key] = match[2].trim();
      }
    }

    // INF lines → modules
    const infPattern = /^\s+INF\s+(.+\.inf)/gim;
    const seen = new Set<string>();
    while ((match = infPattern.exec(content)) !== null) {
      const infPath = match[1].trim();
      if (!seen.has(infPath)) {
        seen.add(infPath);
        const segments = infPath.replace(/\\/g, "/").split("/");
        const name = segments[segments.length - 1].replace(/\.inf$/i, "");
        modules.push({ name, infPath });
      }
    }

    // FILE lines → GUID + type
    const filePattern = /^\s+FILE\s+(\w+)\s*=\s*([0-9A-Fa-f-]{36})/gm;
    while ((match = filePattern.exec(content)) !== null) {
      const type = match[1];
      const guid = match[2];
      if (!modules.find((m) => m.guid === guid)) {
        modules.push({ name: guid.slice(0, 8), guid, type });
      }
    }

    // Count apriori modules
    const aprioriBlock = content.match(/APRIORI\s+(?:DXE|PEI)\s*\{([^}]+)\}/is);
    const aprioriCount = aprioriBlock ? (aprioriBlock[1].match(/INF\s+/gi) ?? []).length : 0;

    metadata["FvName"] = fvName;
    const summary = `Firmware Volume [${fvName}] with ${modules.length} modules (DXE drivers). Apriori: ${aprioriCount} modules.`;

    return {
      subtype: "fv",
      filename,
      sections: [],
      modules: modules.slice(0, 20),
      diagnostics: [],
      metadata,
      summary,
    };
  }
}
