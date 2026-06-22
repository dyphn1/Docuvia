declare module "mammoth" {
  interface ConversionResult {
    value: string;
    messages: unknown[];
  }
  interface Options {
    buffer?: Buffer;
    path?: string;
  }
  export function extractRawText(options: Options): Promise<ConversionResult>;
  export function convertToHtml(options: Options): Promise<ConversionResult>;
}

declare module "officeparser" {
  export class OfficeParser {
    static parseOffice(
      file: Buffer | string,
      callback: (err: Error | null, data: string) => void
    ): void;
    parseOffice(file: Buffer | string, callback: (err: Error | null, data: string) => void): void;
  }
}

declare module "pdf-parse" {
  interface PdfData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  }
  function parse(data: Buffer, options?: Record<string, unknown>): Promise<PdfData>;
  export = parse;
}
