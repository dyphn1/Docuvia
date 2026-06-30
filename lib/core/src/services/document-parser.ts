import { extractBuildArtifactText } from "./build-artifact-parser.js";
import { fork } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function parseInWorker(buffer: Buffer, docType: SupportedDocType): Promise<string> {
  return new Promise((resolve, reject) => {
    // Write buffer to temp file to pass to worker
    const tmpFilePath = path.join(os.tmpdir(), `parse_${crypto.randomBytes(8).toString("hex")}`);
    fs.writeFileSync(tmpFilePath, buffer);

    const workerPath = path.join(__dirname, "parser-worker.js");
    const worker = fork(workerPath, [], {
      execArgv: ["--max-old-space-size=512"],
      detached: false, // Ensure worker dies if parent dies
    });

    // Enforce 60-second timeout
    const timeoutId = setTimeout(() => {
      worker.kill("SIGKILL");
      if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
      reject(new Error(`Parser timeout exceeded for ${docType}`));
    }, 60000);

    worker.on("message", (message: { success: boolean; text?: string; error?: string }) => {
      clearTimeout(timeoutId);
      worker.kill();
      if (message.success) {
        resolve(message.text ?? "");
      } else {
        reject(new Error(message.error ?? "Unknown parsing error"));
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timeoutId);
      if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
      reject(err);
    });

    worker.on("exit", (code, signal) => {
      clearTimeout(timeoutId);
      if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
      if (code !== 0) {
        reject(new Error(`Worker exited abnormally with code ${code} and signal ${signal}`));
      }
    });

    worker.send({ docType, filePath: tmpFilePath });
  });
}

/**
 * Extract plain text from a file buffer or path.
 * @param bufferOrPath  Raw file bytes or path to the file
 * @param docType Detected document type
 * @param filename Original filename (used for build artifact parsing)
 * @returns Extracted plain text string
 */
export async function extractText(
  bufferOrPath: Buffer | string,
  docType: SupportedDocType,
  filename?: string
): Promise<string> {
  const isBuffer = Buffer.isBuffer(bufferOrPath);
  switch (docType) {
    case "pdf":
    case "docx":
    case "pptx":
      if (!isBuffer) {
        const buf = await fs.promises.readFile(bufferOrPath);
        return parseInWorker(buf, docType);
      }
      return parseInWorker(bufferOrPath, docType);
    case "build_artifact": {
      if (!isBuffer) {
        // Read file contents as a string without keeping it in memory longer than necessary
        const content = await fs.promises.readFile(bufferOrPath, "utf-8");
        return extractBuildArtifactText(content, filename ?? "artifact");
      }
      return extractBuildArtifactText(bufferOrPath.toString("utf-8"), filename ?? "artifact");
    }
    case "markdown":
    case "txt":
      if (!isBuffer) {
        return fs.promises.readFile(bufferOrPath, "utf-8");
      }
      return bufferOrPath.toString("utf-8");
    default:
      if (!isBuffer) {
        const content = await fs.promises.readFile(bufferOrPath, "utf-8");
        return content.trim();
      }
      return bufferOrPath.toString("utf-8").trim();
  }
}
