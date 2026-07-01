import { getLlmClientForProject } from "./llm-provider.js";
import { logger } from "../utils/logger.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate a normalized text embedding vector using OpenAI.
 * Returns null on failure (allows graceful fallback to SQL LIKE search).
 */
export async function generateEmbedding(
  projectId: number | undefined,
  text: string
): Promise<number[] | null> {
  if (!text?.trim()) return null;
  try {
    const { client } = await getLlmClientForProject(projectId);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8192),
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    logger.warn({ err }, "[embedding] Failed to generate embedding");
    return null;
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1]; higher is more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Parse a stored JSON embedding string back to a number array.
 * Returns null if the string is invalid or empty.
 */
export function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
    return null;
  } catch {
    return null;
  }
}
