/**
 * Shared constants for Form, InputGroup, Progress, and Command primitives.
 *
 * Values that carry semantic meaning (size tokens, id-suffix conventions,
 * default variant selections, error messages, and numeric limits) are
 * centralized here so they are not duplicated or hardcoded inline inside
 * the component logic files.
 */

// ---------------------------------------------------------------------------
// Form.tsx
// ---------------------------------------------------------------------------

/** Font-size token used for both FormDescription and FormMessage helper text. */
export const FORM_HELP_TEXT_SIZE_CLASS = "text-[0.8rem]";

/** Suffix appended to the generated field id to build the form item's own id. */
export const FORM_ITEM_ID_SUFFIX = "-form-item";

/** Suffix appended to the generated field id to build the description element's id. */
export const FORM_DESCRIPTION_ID_SUFFIX = "-form-item-description";

/** Suffix appended to the generated field id to build the message element's id. */
export const FORM_MESSAGE_ID_SUFFIX = "-form-item-message";

/** Error message thrown when useFormField is called outside a FormFieldContext. */
export const FORM_FIELD_CONTEXT_ERROR_MESSAGE = "useFormField should be used within <FormField>";

/** Error message thrown when useFormField is called outside a FormItemContext. */
export const FORM_ITEM_CONTEXT_ERROR_MESSAGE = "useFormField should be used within <FormItem>";

// ---------------------------------------------------------------------------
// InputGroup.tsx
// ---------------------------------------------------------------------------

/** Slightly smaller border radius token used by compact input-group addons/buttons. */
export const INPUT_GROUP_SMALL_RADIUS_CLASS = "rounded-[calc(var(--radius)-5px)]";

/** Default alignment applied to an InputGroupAddon when none is specified. */
export const INPUT_GROUP_ADDON_DEFAULT_ALIGN = "inline-start" as const;

/** Default size applied to an InputGroupButton when none is specified. */
export const INPUT_GROUP_BUTTON_DEFAULT_SIZE = "xs" as const;

/** Default HTML button type applied to an InputGroupButton when none is specified. */
export const INPUT_GROUP_BUTTON_DEFAULT_TYPE = "button" as const;

/** Default visual variant applied to an InputGroupButton when none is specified. */
export const INPUT_GROUP_BUTTON_DEFAULT_VARIANT = "ghost" as const;

// ---------------------------------------------------------------------------
// Progress.tsx
// ---------------------------------------------------------------------------

/** Upper bound of the progress value range (percentage scale). */
export const PROGRESS_MAX_VALUE = 100;

// ---------------------------------------------------------------------------
// Command.tsx
// ---------------------------------------------------------------------------

/** Maximum height applied to the scrollable CommandList viewport. */
export const COMMAND_LIST_MAX_HEIGHT_CLASS = "max-h-[300px]";
