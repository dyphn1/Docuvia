/**
 * Shared and per-component constants for the Radix-based menu primitives:
 * ContextMenu.tsx, DropdownMenu.tsx, and Menubar.tsx.
 *
 * Values were diffed character-for-character across ContextMenu and
 * DropdownMenu before consolidating. Only truly identical values were
 * merged into a single shared export; values that differ (even subtly)
 * are kept as separate, component-prefixed exports.
 */

// Shared identical z-index token used by ContextMenu and DropdownMenu content/sub-content.
export const MENU_Z_INDEX_CLASS = "z-50";

// Shared identical wrapper classes for the checkbox/radio item indicator icon,
// used by ContextMenu and DropdownMenu.
export const MENU_ITEM_INDICATOR_WRAPPER_CLASSES =
  "absolute left-2 flex h-3.5 w-3.5 items-center justify-center";

// ContextMenu content open/close animation classes.
// Differs from the DropdownMenu equivalent only in the component-specific
// `origin-[--radix-*-content-transform-origin]` CSS custom property name.
export const CONTEXT_MENU_CONTENT_ANIMATION_CLASSES =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-context-menu-content-transform-origin]";

// DropdownMenu content open/close animation classes.
// Differs from the ContextMenu equivalent only in the component-specific
// `origin-[--radix-*-content-transform-origin]` CSS custom property name.
export const DROPDOWN_MENU_CONTENT_ANIMATION_CLASSES =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]";

// ContextMenu checkbox/radio item classes.
// Differs from the DropdownMenu equivalent: does NOT include `transition-colors`.
export const CONTEXT_MENU_INDICATOR_ITEM_CLASSES =
  "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

// DropdownMenu checkbox/radio item classes.
// Differs from the ContextMenu equivalent: includes `transition-colors`.
export const DROPDOWN_MENU_INDICATOR_ITEM_CLASSES =
  "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

// Menubar content/sub-content open/close transition classes.
// NOT identical to the ContextMenu/DropdownMenu animation classes above:
// - uses the menubar-specific `origin-[--radix-menubar-content-transform-origin]` token
// - omits `data-[state=closed]:animate-out` (that state is applied inline, mixed into
//   the surrounding Tailwind className string, only on MenubarSubContent — MenubarContent
//   does not apply it at all). This asymmetry is intentional and preserved as-is.
export const MENUBAR_CONTENT_TRANSITION_CLASSES =
  "data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-menubar-content-transform-origin]";

// Default positioning offset (px) for DropdownMenuContent relative to its trigger.
export const DROPDOWN_MENU_CONTENT_SIDE_OFFSET = 4;

// Default alignment and offsets (px) for MenubarContent relative to its trigger.
export const MENUBAR_CONTENT_ALIGN = "start";
export const MENUBAR_CONTENT_ALIGN_OFFSET = -4;
export const MENUBAR_CONTENT_SIDE_OFFSET = 8;
