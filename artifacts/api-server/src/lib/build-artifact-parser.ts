export type BuildArtifactSubtype = "map" | "fv" | "fd" | "compile-log";

export interface MemorySection {
  name: string;
  address?: string;
  size?: number;
  sizeHex?: string;
}

export interface FirmwareModule {
  name: string;
  guid?: string;
  infPath?: string;
  type?: string;
}

export interface BuildDiagnostic {
  severity: "error" | "warning";
  module?: string;
  file?: string;
  line?: number;
  message: string;
}

export interface ParsedBuildArtifact {
  subtype: BuildArtifactSubtype;
  filename: string;
  sections: MemorySection[];
  modules: FirmwareModule[];
  diagnostics: BuildDiagnostic[];
  metadata: Record<string, string>;
  summary: string;
}

export function detectSubtype(filename: string, content: string): BuildArtifactSubtype {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "map") return "map";
  if (ext === "fv") return "fv";
  if (ext === "fd") return "fd";

  if (/DEFINE FV_NAMESPACE|\[FV\./i.test(content)) return "fv";
  if (/\[FD\./i.test(content)) return "fd";

  const errorCount = (content.match(/\berror:/gi) ?? []).length;
  const warningCount = (content.match(/\bwarning:/gi) ?? []).length;
  if (errorCount + warningCount > 3) return "compile-log";

  return "compile-log";
}

export function parseMapFile(content: string, filename: string): ParsedBuildArtifact {
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
  const largest = top20.slice(0, 2).map((s) => `${s.name} (${Math.round((s.size ?? 0) / 1024)} KB)`).join(", ");
  const summary = `Linker map with ${sections.length} sections. Largest: ${largest || "N/A"}. Total image size: ${Math.round(totalSize / 1024)} KB.`;

  return {
    subtype: "map",
    filename,
    sections: top20,
    modules: modules.slice(0, 20),
    diagnostics: [],
    metadata: { totalSections: String(sections.length), totalSizeKB: String(Math.round(totalSize / 1024)) },
    summary,
  };
}

export function parseFvFile(content: string, filename: string): ParsedBuildArtifact {
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

export function parseFdFile(content: string, filename: string): ParsedBuildArtifact {
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

export function parseCompileLog(content: string, filename: string): ParsedBuildArtifact {
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

export function formatAsBuildArtifactText(parsed: ParsedBuildArtifact): string {
  const lines: string[] = [];

  lines.push(`# Build Artifact: ${parsed.subtype.toUpperCase()} — ${parsed.filename}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(parsed.summary);

  if (Object.keys(parsed.metadata).length > 0) {
    lines.push("");
    lines.push("## Metadata");
    for (const [key, value] of Object.entries(parsed.metadata)) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  if (parsed.sections.length > 0) {
    lines.push("");
    lines.push(`## Memory Sections / Flash Regions (top ${Math.min(parsed.sections.length, 10)})`);
    lines.push("| Name | Address | Size |");
    lines.push("|------|---------|------|");
    for (const s of parsed.sections.slice(0, 10)) {
      const sizeStr = s.size != null ? `${Math.round(s.size / 1024)} KB` : (s.sizeHex ?? "");
      lines.push(`| ${s.name} | ${s.address ?? ""} | ${sizeStr} |`);
    }
  }

  if (parsed.modules.length > 0) {
    lines.push("");
    lines.push(`## Firmware Modules (${parsed.modules.length} total)`);
    for (const m of parsed.modules.slice(0, 20)) {
      const detail = m.infPath ? ` (${m.infPath})` : m.guid ? ` [${m.guid}]` : "";
      lines.push(`- ${m.name}${detail}`);
    }
  }

  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  const warnings = parsed.diagnostics.filter((d) => d.severity === "warning");

  if (parsed.diagnostics.length > 0) {
    lines.push("");
    lines.push("## Build Diagnostics");
    if (errors.length > 0) {
      lines.push(`### Errors (${errors.length})`);
      for (const d of errors.slice(0, 10)) {
        const loc = d.file ? `[${d.file}${d.line != null ? `:${d.line}` : ""}]` : "";
        lines.push(`- ${loc} ${d.message}`);
      }
    }
    if (warnings.length > 0) {
      lines.push(`### Warnings (${warnings.length})`);
      for (const d of warnings.slice(0, 10)) {
        const loc = d.file ? `[${d.file}${d.line != null ? `:${d.line}` : ""}]` : "";
        lines.push(`- ${loc} ${d.message}`);
      }
    }
  }

  return lines.join("\n");
}

export function extractBuildArtifactText(content: string, filename: string): string {
  const subtype = detectSubtype(filename, content);
  let parsed: ParsedBuildArtifact;

  switch (subtype) {
    case "map":
      parsed = parseMapFile(content, filename);
      break;
    case "fv":
      parsed = parseFvFile(content, filename);
      break;
    case "fd":
      parsed = parseFdFile(content, filename);
      break;
    case "compile-log":
    default:
      parsed = parseCompileLog(content, filename);
      break;
  }

  return formatAsBuildArtifactText(parsed);
}
