import { ENCODING_HEX, ENCODING_BASE64, HASH_ALGO_SHA256, HASH_ALGO_MD5 } from "@workspace/core";
import fs from "fs";
import crypto from "crypto";

export function computeHashFromStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(HASH_ALGO_SHA256);
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest(ENCODING_HEX)));
    stream.on("error", reject);
  });
}

export function computeHashFromBuffer(buffer: Buffer): string {
  return crypto.createHash(HASH_ALGO_SHA256).update(buffer).digest(ENCODING_HEX);
}
