import { LanguageRegistry } from "./language-registry.js";
import { UTF8_ENCODING } from "@workspace/contracts";

const FunnelRejectionReasons = {
  BINARY_FILE_DETECTED: "Binary file detected (NUL byte found)",
  INVALID_UTF8: "Lossless Encoding Guardrail failed (Invalid UTF-8)",
  NO_EXTENSION_NO_SHEBANG: "No file extension and no shebang detected",
  EXTENSION_NOT_ALLOWED: (ext: string) => `Extension ${ext} not allowed`,
} as const;

const ShebangMarkers = {
  NODE: "node",
  JS: "js",
  PYTHON: "python",
  BASH: "bash",
  SH: "sh",
} as const;

const ShebangExtensions = {
  JAVASCRIPT: ".js",
  PYTHON: ".py",
  SHELL: ".sh",
} as const;

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
    if (this.containsNulByte(buffer)) {
      return {
        accepted: false,
        reason: FunnelRejectionReasons.BINARY_FILE_DETECTED,
      };
    }

    // Step D: Lossless Encoding Guardrail
    if (contentString === undefined) {
      const decoded = this.decodeUtf8OrNull(buffer);
      if (decoded === null) {
        return {
          accepted: false,
          reason: FunnelRejectionReasons.INVALID_UTF8,
        };
      }
      contentString = decoded;
    }

    // Step A & B: Extension Allowlist & Shebang Detection
    const mappedExtension = this.resolveMappedExtension(ext, contentString);

    if (!mappedExtension || mappedExtension === "") {
      return {
        accepted: false,
        reason: FunnelRejectionReasons.NO_EXTENSION_NO_SHEBANG,
      };
    }

    const provider = this.registry.getProviderForExtension(mappedExtension);
    if (!provider) {
      return {
        accepted: false,
        reason: FunnelRejectionReasons.EXTENSION_NOT_ALLOWED(mappedExtension),
      };
    }

    return { accepted: true, mappedExtension };
  }

  /** Inspects the first 8000 bytes for a NUL byte, the git binary-detection heuristic. */
  private containsNulByte(buffer: Uint8Array): boolean {
    const checkLength = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  }

  /** Strictly decodes a buffer as UTF-8, returning `null` on any invalid byte sequence. */
  private decodeUtf8OrNull(buffer: Uint8Array): string | null {
    try {
      // Use fatal: true to strictly enforce valid UTF-8
      return new TextDecoder(UTF8_ENCODING, { fatal: true }).decode(buffer);
    } catch (err) {
      return null;
    }
  }

  /**
   * Resolves the extension used for provider lookup: the passed-in `ext` if present,
   * otherwise whatever `detectShebangExtension` can infer from the file content.
   */
  private resolveMappedExtension(
    ext: string,
    contentString: string | undefined,
  ): string {
    if (!ext || ext === "") {
      return this.detectShebangExtension(contentString) || ext;
    }
    return ext;
  }

  /** Maps a shebang line to a known extension; returns undefined when no shebang matches. */
  private detectShebangExtension(
    contentString: string | undefined,
  ): string | undefined {
    const firstLineMatch = contentString
      ? contentString.match(/^(?:#!\s*)(.*)/)
      : null;
    if (!firstLineMatch) return undefined;

    const shebang = firstLineMatch[1];
    if (
      shebang.includes(ShebangMarkers.NODE) ||
      shebang.includes(ShebangMarkers.JS)
    ) {
      return ShebangExtensions.JAVASCRIPT;
    }
    if (shebang.includes(ShebangMarkers.PYTHON)) {
      return ShebangExtensions.PYTHON;
    }
    if (
      shebang.includes(ShebangMarkers.BASH) ||
      shebang.includes(ShebangMarkers.SH)
    ) {
      return ShebangExtensions.SHELL;
    }
    return undefined;
  }
}
