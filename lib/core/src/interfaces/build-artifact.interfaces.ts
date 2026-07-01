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

export interface IBuildArtifactParser {
  canParse(filename: string, content: string): boolean;
  parse(content: string, filename: string): ParsedBuildArtifact;
}
