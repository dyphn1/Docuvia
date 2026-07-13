import { LanguageRegistry } from "./language-registry.js";

export interface FunnelResult {
  accepted: boolean;
  reason?: string;
  mappedExtension?: string;
}

export class ParsingFunnel {
  constructor(private registry: LanguageRegistry) {}

  public process(
    fileContent: Uint8Array | string,
    filePath: string,
    ext: string,
  ): FunnelResult {
    let buffer: Uint8Array;
    let contentString: string | undefined;

    if (typeof fileContent === "string") {
      buffer = new TextEncoder().encode(fileContent);
      contentString = fileContent;
    } else {
      buffer = fileContent;
    }

    // Step C: Git Binary Bypass (inspect first 8000 bytes for \0)
    const checkLength = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        return {
          accepted: false,
          reason: "Binary file detected (NUL byte found)",
        };
      }
    }

    // Step D: Lossless Encoding Guardrail
    if (contentString === undefined) {
      try {
        // Use fatal: true to strictly enforce valid UTF-8
        contentString = new TextDecoder("utf-8", { fatal: true }).decode(
          buffer,
        );
      } catch (err) {
        return {
          accepted: false,
          reason: "Lossless Encoding Guardrail failed (Invalid UTF-8)",
        };
      }
    }

    // Step A & B: Extension Allowlist & Shebang Detection
    let mappedExtension = ext;

    if (!mappedExtension || mappedExtension === "") {
      // Try shebang detection
      const firstLineMatch = contentString
        ? contentString.match(/^(?:#!\s*)(.*)/)
        : null;
      if (firstLineMatch) {
        const shebang = firstLineMatch[1];
        if (shebang.includes("node") || shebang.includes("js")) {
          mappedExtension = ".js";
        } else if (shebang.includes("python")) {
          mappedExtension = ".py";
        } else if (shebang.includes("bash") || shebang.includes("sh")) {
          mappedExtension = ".sh";
        }
      }
    }

    if (!mappedExtension || mappedExtension === "") {
      return {
        accepted: false,
        reason: "No file extension and no shebang detected",
      };
    }

    const provider = this.registry.getProviderForExtension(mappedExtension);
    if (!provider) {
      return {
        accepted: false,
        reason: `Extension ${mappedExtension} not allowed`,
      };
    }

    return { accepted: true, mappedExtension };
  }
}
