import { EXAMPLE_PREVIEW_COMPONENT_NAME, PREVIEW_ROUTE_PREFIX } from "../constants/preview-routes";

const PREVIEW_PATH_PATTERN = new RegExp(`^${PREVIEW_ROUTE_PREFIX}(.+)$`);

export function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

export function getPreviewExamplePath(): string {
  const basePath = getBasePath();
  return `${basePath}${PREVIEW_ROUTE_PREFIX}${EXAMPLE_PREVIEW_COMPONENT_NAME}`;
}

export function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const { pathname } = window.location;
  const local =
    basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;
  const match = local.match(PREVIEW_PATH_PATTERN);
  return match ? match[1] : null;
}
