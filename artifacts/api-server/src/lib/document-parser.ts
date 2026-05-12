import { extractBuildArtifactText } from "./build-artifact-parser.js";

export type SupportedDocType = "markdown" | "txt" | "pdf" | "docx" | "pptx" | "build_artifact";

/**
 * Detect doc type from file extension.
 */
export function detectDocType(filename: string): SupportedDocType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, SupportedDocType> = {
    md: "markdown",
    txt: "txt",
    pdf: "pdf",
    docx: "docx",
    pptx: "pptx",
    map: "build_artifact",
    fv: "build_artifact",
    fd: "build_artifact",
    log: "build_artifact",
  };
  return map[ext] ?? "txt";
}

async function parsePdf(buffer: Buffer): Promise<string> {
  // Lazy import to avoid DOMMatrix issue at startup
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text.trim();
}

async function parseDocx(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require("mammoth") as {
    extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function parsePptx(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OfficeParser } = require("officeparser") as {
      OfficeParser: {
        parseOffice: (
          file: Buffer,
          callback: (err: Error | null, data: string) => void
        ) => void;
      };
    };
    OfficeParser.parseOffice(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data ?? "");
    });
  });
}

/**
 * Extract plain text from a file buffer.
 * @param buffer  Raw file bytes
 * @param docType Detected document type
 * @param filename Original filename (used for build artifact parsing)
 * @returns Extracted plain text string
 */
export async function extractText(buffer: Buffer, docType: SupportedDocType, filename?: string): Promise<string> {
  switch (docType) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "pptx":
      return parsePptx(buffer);
    case "build_artifact":
      return extractBuildArtifactText(buffer.toString("utf-8"), filename ?? "artifact");
    case "markdown":
    case "txt":
    default:
      return buffer.toString("utf-8").trim();
  }
}
