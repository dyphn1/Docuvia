/**
 * Constants for the Sidebar component (Sidebar.tsx).
 */

export const SIDEBAR_COOKIE_NAME = "sidebar_state";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
export const SIDEBAR_WIDTH = "16rem";
export const SIDEBAR_WIDTH_MOBILE = "18rem";
export const SIDEBAR_WIDTH_ICON = "3rem";
export const SIDEBAR_KEYBOARD_SHORTCUT = "b";

export const SIDEBAR_SLOT = "sidebar";

// Shared class fragments reused across several sidebar subcomponents.
export const HIDDEN_WHEN_COLLAPSED_TO_ICON_CLASS = "group-data-[collapsible=icon]:hidden";
export const MOBILE_HIT_AREA_CLASS = "after:absolute after:-inset-2 md:after:hidden";
export const MENU_BUTTON_SIZE_TOP_OFFSET_CLASS =
  "peer-data-[size=sm]/menu-button:top-1 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5";

export const SKELETON_TEXT_WIDTH_MIN_PERCENT = 50;
export const SKELETON_TEXT_WIDTH_RANGE_PERCENT = 40;

// Delay (ms) before tooltips inside the sidebar's TooltipProvider appear.
export const SIDEBAR_TOOLTIP_DELAY_DURATION_MS = 0;
