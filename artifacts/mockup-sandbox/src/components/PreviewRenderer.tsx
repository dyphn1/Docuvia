import { useEffect, useState, type ComponentType } from "react";
import { MOCKUPS_DIR_NAME, MOCKUP_FILE_EXTENSION } from "../constants/mockups";
import { PREVIEW_ERROR_MESSAGES } from "../constants/preview-messages";

export type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

export interface PreviewRendererProps {
  componentPath: string;
  modules: ModuleMap;
}

function lastFunctionExport(mod: Record<string, unknown>): ComponentType | undefined {
  const fns = Object.values(mod).filter((v) => typeof v === "function");
  return fns[fns.length - 1] as ComponentType | undefined;
}

function resolveComponent(mod: Record<string, unknown>, name: string): ComponentType | undefined {
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    lastFunctionExport(mod)
  );
}

export function PreviewRenderer({ componentPath, modules }: PreviewRendererProps) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const key = `./${MOCKUPS_DIR_NAME}/${componentPath}${MOCKUP_FILE_EXTENSION}`;
      const loader = modules[key];
      if (!loader) {
        setError(PREVIEW_ERROR_MESSAGES.COMPONENT_NOT_FOUND(componentPath));
        return;
      }

      try {
        const mod = await loader();
        if (cancelled) {
          return;
        }
        const name = componentPath.split("/").pop() ?? "";
        const comp = resolveComponent(mod, name);
        if (!comp) {
          setError(PREVIEW_ERROR_MESSAGES.NO_EXPORTED_COMPONENT(componentPath));
          return;
        }
        setComponent(() => comp);
      } catch (e) {
        if (cancelled) {
          return;
        }

        const message = e instanceof Error ? e.message : String(e);
        setError(PREVIEW_ERROR_MESSAGES.LOAD_FAILED(message));
      }
    }

    void loadComponent();

    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return <pre style={{ color: "red", padding: "2rem", fontFamily: "system-ui" }}>{error}</pre>;
  }

  if (!Component) return null;

  return <Component />;
}
