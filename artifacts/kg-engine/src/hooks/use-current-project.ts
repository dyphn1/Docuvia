import { useState, useCallback } from "react";
import { CURRENT_PROJECT_STORAGE_KEY as STORAGE_KEY } from "@/constants/app";

export function useCurrentProject() {
  const [projectId, setProjectIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return isNaN(parsed) ? null : parsed;
  });

  const setProjectId = useCallback((id: number | null) => {
    setProjectIdState(id);
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
    }
  }, []);

  return { projectId, setProjectId };
}
