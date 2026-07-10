import {
  NormalizedRequest,
  NormalizedResponse,
  ProviderProfile,
  ProviderTransport,
} from "./types.js";

export interface OrchestratorOptions {
  profile: ProviderProfile;
  transport: ProviderTransport;
  apiKey: string;
}

export class LLMOrchestrator {
  private profile: ProviderProfile;
  private transport: ProviderTransport;
  private apiKey: string;

  constructor(options: OrchestratorOptions) {
    this.profile = options.profile;
    this.transport = options.transport;
    this.apiKey = options.apiKey;
  }

  private getHeaders(): Record<string, string> {
    return this.transport.getAuthHeaders(this.apiKey);
  }

  private getUrl(stream: boolean): string {
    return this.transport.buildUrl(this.profile.baseUrl, stream);
  }

  /** Parses one SSE line into its JSON payload, or null if the line carries no usable data. */
  private parseSSELine(line: string): unknown | null {
    if (line.trim() === "" || line.startsWith(":") || !line.startsWith("data: ")) return null;

    const data = line.slice(6);
    if (data === "[DONE]") return null;

    try {
      return JSON.parse(data);
    } catch {
      // Ignore parse errors on incomplete chunks
      return null;
    }
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const transformedReq = this.transport.transformRequest(req);
    const url = this.getUrl(false);

    const res = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(transformedReq),
    });

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return this.transport.transformResponse(data);
  }

  async *generateStream(req: NormalizedRequest): AsyncGenerator<string, void, unknown> {
    const streamReq = { ...req, stream: true };
    const transformedReq = this.transport.transformRequest(streamReq);
    const url = this.getUrl(true);

    const res = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(transformedReq),
    });

    if (!res.ok) {
      throw new Error(`Stream request failed with status ${res.status}: ${await res.text()}`);
    }

    if (!res.body) {
      throw new Error("No response body stream");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const parsed = this.parseSSELine(line);
        if (parsed == null) continue;
        const chunk = this.transport.transformStreamChunk?.(parsed) || "";
        if (chunk) yield chunk;
      }
    }
  }
}
