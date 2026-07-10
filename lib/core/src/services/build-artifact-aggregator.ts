import {
  IBuildArtifactParser,
  ParsedBuildArtifact,
} from "../interfaces/build-artifact.interfaces.js";
import { MapParser } from "./build-artifacts/map-parser.js";
import { FvParser } from "./build-artifacts/fv-parser.js";
import { FdParser } from "./build-artifacts/fd-parser.js";
import { CompileLogParser } from "./build-artifacts/compile-log-parser.js";

export class BuildArtifactAggregator {
  private parsers: IBuildArtifactParser[];

  constructor() {
    this.parsers = [
      new MapParser(),
      new FvParser(),
      new FdParser(),
      new CompileLogParser(), // Fallback parser should be last
    ];
  }

  public extractBuildArtifactText(content: string, filename: string): string {
    for (const parser of this.parsers) {
      if (parser.canParse(filename, content)) {
        const parsed = parser.parse(content, filename);
        return this.formatAsBuildArtifactText(parsed);
      }
    }

    // Should never be reached because CompileLogParser always returns true
    return "";
  }

  public formatAsBuildArtifactText(parsed: ParsedBuildArtifact): string {
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
      lines.push(
        `## Memory Sections / Flash Regions (top ${Math.min(parsed.sections.length, 10)})`
      );
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
      for (const [label, group] of [
        ["Errors", errors],
        ["Warnings", warnings],
      ] as const) {
        if (group.length === 0) continue;
        lines.push(`### ${label} (${group.length})`);
        for (const d of group.slice(0, 10)) {
          const loc = d.file ? `[${d.file}${d.line != null ? `:${d.line}` : ""}]` : "";
          lines.push(`- ${loc} ${d.message}`);
        }
      }
    }

    return lines.join("\n");
  }
}

// Keep a singleton instance and export the old function signature for backward compatibility
const aggregator = new BuildArtifactAggregator();

export function extractBuildArtifactText(content: string, filename: string): string {
  return aggregator.extractBuildArtifactText(content, filename);
}

export function formatAsBuildArtifactText(parsed: ParsedBuildArtifact): string {
  return aggregator.formatAsBuildArtifactText(parsed);
}
