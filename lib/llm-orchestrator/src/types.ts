export interface NormalizedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface NormalizedRequest {
  model: string;
  messages: NormalizedMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: any;
}

export interface NormalizedResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ProviderProfile {
  name: string;
  baseUrl: string;
  defaultModel: string;
}

export interface ProviderTransport {
  getAuthHeaders(apiKey: string): Record<string, string>;
  buildUrl(baseUrl: string, stream: boolean): string;
  transformRequest(req: NormalizedRequest): any;
  transformResponse(res: any): NormalizedResponse;
  transformStreamChunk?(chunk: any): string;
}
