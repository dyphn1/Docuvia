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
    if (this.profile.name === "anthropic") {
      return {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      };
    } else if (this.profile.name === "gemini") {
      return {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      };
    } else {
      // Default to OpenAI compatible
      return {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      };
    }
  }

  private getUrl(stream: boolean): string {
    let url = this.profile.baseUrl;
    if (this.profile.name === "openai" && !url.endsWith("/chat/completions")) {
      url = url.endsWith("/") ? `${url}chat/completions` : `${url}/chat/completions`;
    } else if (this.profile.name === "gemini") {
      const endpoint = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      // Assume baseUrl includes model part, if not it needs appending
      url = `${url}:${endpoint}`;
    }
    return url;
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
        if (line.trim() === "" || line.startsWith(":")) continue;
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const chunk = this.transport.transformStreamChunk?.(parsed) || "";
            if (chunk) yield chunk;
          } catch (e) {
            // Ignore parse errors on incomplete chunks
          }
        }
      }
    }
  }
}
