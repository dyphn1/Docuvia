export class SyncService {
  constructor(
    private workspaceRoot: string,
    private apiUrl: string,
    private mcpPat: string,
    private onProgress?: (msg: string) => void
  ) {}

  public async sync(projectId: string, commitSha?: string): Promise<void> {
    const formattedApiUrl = this.apiUrl.replace(/\/+$/, "");
    if (this.onProgress) {
      this.onProgress(`Syncing project ${projectId}...`);
    }

    const res = await fetch(`${formattedApiUrl}/api/projects/${projectId}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.mcpPat}`,
        "Content-Type": "application/json",
      },
      body: commitSha ? JSON.stringify({ commitSha }) : undefined,
    });

    const body = (await res.json()) as { error?: string; message?: string };
    if (!res.ok) {
      throw new Error(String(body.error ?? "Sync failed"));
    }

    if (this.onProgress) {
      this.onProgress(String(body.message ?? "Sync completed"));
    }
  }
}
