/**
 * Files at/above this size are skipped during discovery rather than fully read and
 * handed to a parse worker. Matches GitNexus's documented oversized-file threshold,
 * so file-count comparisons between the two tools are apples-to-apples.
 */
export const MAX_FILE_SIZE_BYTES = 512_000;
