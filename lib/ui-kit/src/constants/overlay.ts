/**
 * Shared design tokens for Radix-based modal/overlay primitives
 * (AlertDialog, Dialog, Drawer, Sheet).
 *
 * These values were previously duplicated verbatim across each component
 * file. They are consolidated here as the single source of truth so the
 * four primitives stay visually consistent.
 */

/**
 * Stacking-context z-index applied to overlay backdrops and dialog/sheet
 * content layers. Identical across AlertDialog, Dialog, Drawer, and Sheet.
 */
export const OVERLAY_Z_INDEX_CLASS = "z-50";

/**
 * Fade in/out animation classes applied to overlay backdrops (and, for
 * AlertDialog/Dialog, their content panels). Identical across AlertDialog,
 * Dialog, and Sheet. Drawer does not use this fade token.
 */
export const OVERLAY_FADE_TRANSITION_CLASSES =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

/**
 * Max width applied to the left/right "side" variants of Sheet content.
 * Sheet-specific — not shared with the other overlay primitives.
 */
export const SHEET_SIDE_MAX_WIDTH = "sm:max-w-sm";
