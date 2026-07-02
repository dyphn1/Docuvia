/// <reference types="vite/client" />
declare module "*mockup-components" {
  export const modules: Record<string, () => Promise<Record<string, unknown>>>;
}
