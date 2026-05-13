import type { Project } from "@workspace/api-client-react";

type ProjectListEnvelope = {
  projects?: Project[];
  data?: Project[];
  items?: Project[];
};

export function normalizeProjects(value: unknown): Project[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const envelope = value as ProjectListEnvelope;
    return envelope.projects ?? envelope.data ?? envelope.items ?? [];
  }

  return [];
}
