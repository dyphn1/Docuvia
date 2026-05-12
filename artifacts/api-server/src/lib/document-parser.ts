import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { OfficeParser } from "officeparser";

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
  };
  return map[ext] ?? "txt";
}

/**
 * Extract plain text from a file buffer.
 * @param buffer  Raw file bytes
 * @param docType Detected document type
 * @returns Extracted plain text string
 */
export async function extractText(buffer: Buffer, docType: SupportedDocType): Promise<string> {
  switch (docType) {
    case "pdf": {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result.text.trim();
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    }
    case "pptx": {
      const ast = await OfficeParser.parseOffice(buffer);
      return ast.toText().trim();
    }
    case "markdown":
    case "txt":
    case "build_artifact":
    default:
      return buffer.toString("utf-8").trim();
  }
}
