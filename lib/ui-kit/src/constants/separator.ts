/**
 * Shared constants for the Separator primitive.
 */

/** Layout classes keyed by orientation for the separator's own bar. */
export const SEPARATOR_ORIENTATION_CLASSNAMES: Record<"horizontal" | "vertical", string> = {
  horizontal: "h-[1px] w-full",
  vertical: "h-full w-[1px]",
};

/** Default orientation applied when none is specified. */
export const SEPARATOR_DEFAULT_ORIENTATION = "horizontal" as const;

/** Default decorative flag applied when none is specified (purely visual, not semantic). */
export const SEPARATOR_DEFAULT_DECORATIVE = true;
