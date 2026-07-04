# Mockup Sandbox (`@workspace/mockup-sandbox`)

## What it is

Not a product feature — this is an internal **component preview sandbox** for rapid UI prototyping, isolated from [kg-engine](kg-engine.md). It has no API dependency and no backend calls; it's pure client-side rendering used while designing new dashboard UI before wiring it into the real app.

|             |                                                                         |
| ----------- | ----------------------------------------------------------------------- |
| Package     | `@workspace/mockup-sandbox`                                             |
| Entry point | `src/main.tsx` (React root), `src/App.tsx` (gallery / preview renderer) |
| Scripts     | `dev`, `build`, `preview`                                               |

## How it works

A custom Vite plugin at `artifacts/mockup-sandbox/mockup-preview-plugin.ts` watches `src/components/mockups/` with `chokidar`. Whenever a `.tsx` file is added or changed there, the plugin regenerates `src/.generated/mockup-components.ts` — a map of component name → lazy import. The app then serves each discovered component at `/preview/<ComponentName>` with hot reload; a gallery view lists everything currently discoverable.

```
src/
  components/
    mockups/     — drop a .tsx file here, it's auto-registered
    ui/          — shared building blocks (Radix-based)
  .generated/    — auto-generated component map (do not hand-edit)
  hooks/, lib/   — supporting utilities
```

## Usage

Run `pnpm --filter @workspace/mockup-sandbox run dev`, drop a new component under `src/components/mockups/`, and it appears in the gallery immediately — no route registration or import wiring needed. Useful for reviewing a new dashboard widget in isolation before porting it into [kg-engine](kg-engine.md).
