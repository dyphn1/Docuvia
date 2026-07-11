import type { ChangeDetectionResult } from "@workspace/contracts";

/** `review`'s result is exactly the Domain Core's `ChangeDetectionResult` shape (no ui-core-specific fields to add). */
export type ReviewResult = ChangeDetectionResult;
