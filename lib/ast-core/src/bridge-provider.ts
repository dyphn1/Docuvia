/**
 * Bridge Provider — Cross-Language Edge Detection
 *
 * Parses API contract files (OpenAPI 3.x, Swagger 2.0) and emits api_contract
 * JSONL events that the ingestion pipeline uses to create cross-language
 * dependency edges (e.g., a TypeScript frontend module → a Python backend endpoint).
 *
 * This enables cross-language knowledge graph links without requiring a full
 * AST parse of every file — structured API specs are a "bridge" between
 * language ecosystems.
 */

import { AstEvent } from "./sink.js";

export interface BridgeParseResult {
  events: AstEvent[];
  contractName: string;
  endpointCount: number;
}

/**
 * Parse an OpenAPI 3.x / Swagger 2.0 YAML or JSON spec and emit api_contract events.
 *
 * Each event represents an API endpoint with its method, path, and summary.
 * The ingestion pipeline can link these to L2 nodes via path pattern matching
 * or naming conventions (e.g., an SDK client calls a documented endpoint).
 */
export async function parseOpenApiSpec(
  content: string,
  filePath: string,
  format: "yaml" | "json"
): Promise<BridgeParseResult> {
  let spec: any;

  try {
    if (format === "yaml") {
      // Dynamic import to avoid pulling js-yaml into the default tree-sitter path
      const yaml = await import("js-yaml");
      spec = yaml.load(content);
    } else {
      spec = JSON.parse(content);
    }
  } catch (err: any) {
    return { events: [], contractName: "", endpointCount: 0 };
  }

  if (!spec || typeof spec !== "object") {
    return { events: [], contractName: "", endpointCount: 0 };
  }

  // Detect OpenAPI version
  const isOpenApi3 = spec.openapi && typeof spec.openapi === "string";
  const isSwagger2 = spec.swagger && typeof spec.swagger === "string";

  if (!isOpenApi3 && !isSwagger2) {
    return { events: [], contractName: "", endpointCount: 0 };
  }

  const contractName = (spec.info && spec.info.title) || filePath.replace(/\.(yaml|yml|json)$/, "");

  const events: AstEvent[] = [];
  const paths = spec.paths || {};

  // Emit a top-level contract event
  events.push({
    type: "api_contract",
    contractName,
    version: isOpenApi3 ? spec.openapi : spec.swagger,
    description: spec.info?.description || "",
    filePath,
    basePath: extractBasePath(spec),
  });

  // Emit one event per endpoint
  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    const methods = ["get", "post", "put", "delete", "patch", "options", "head"];
    for (const method of methods) {
      const operation = (pathItem as any)[method];
      if (!operation || typeof operation !== "object") continue;

      const summary =
        operation.summary || operation.description || `${method.toUpperCase()} ${routePath}`;
      const operationId = operation.operationId || null;
      const tags = Array.isArray(operation.tags) ? operation.tags : [];

      events.push({
        type: "api_contract",
        contractName,
        version: isOpenApi3 ? spec.openapi : spec.swagger,
        method: method.toUpperCase(),
        path: routePath,
        fullPath: `${extractBasePath(spec)}${routePath}`,
        summary,
        operationId,
        tags,
        filePath,
        // Cross-language link hints — matching hints for consumer
        // detection: tags or operationId can be used to match
        // function names in client SDKs.
        consumers: extractConsumers(operation),
      });
    }
  }

  return {
    events,
    contractName,
    endpointCount: events.filter((e) => e.type === "api_contract" && e.method).length,
  };
}

/**
 * Detect if a file is likely an OpenAPI spec by inspecting its content.
 * Fast path: check for 'openapi' or 'swagger' key at root level.
 */
export function isOpenApiFile(content: string, ext: string): boolean {
  if (![".yaml", ".yml", ".json"].includes(ext.toLowerCase())) {
    return false;
  }

  // Quick scan for the signature key (faster than full parse)
  const lines = content.split("\n", 20);
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("openapi:") ||
      trimmed.startsWith("swagger:") ||
      trimmed.startsWith('"openapi":') ||
      trimmed.startsWith('"swagger":')
    ) {
      return true;
    }
  }
  return false;
}

function extractBasePath(spec: any): string {
  if (spec.servers && Array.isArray(spec.servers) && spec.servers[0]) {
    const url = spec.servers[0].url;
    if (url && typeof url === "string") {
      // Strip scheme/host if present, keep path
      try {
        const u = new URL(url);
        return u.pathname === "/" ? "" : u.pathname;
      } catch {
        // Relative path
        return url.startsWith("/") ? url : "";
      }
    }
  }
  if (spec.host && spec.basePath) {
    return spec.basePath;
  }
  return "";
}

/**
 * Extract consumer hints from an OpenAPI operation.
 * These hints help the ingestion pipeline match API endpoints to
 * client-side function calls across languages.
 */
function extractConsumers(operation: any): string[] {
  const consumers: string[] = [];

  // Look for x-consumer or x-client extensions
  for (const key of Object.keys(operation)) {
    if (key.startsWith("x-consumer") || key.startsWith("x-client")) {
      const val = operation[key];
      if (typeof val === "string") {
        consumers.push(val);
      } else if (Array.isArray(val)) {
        consumers.push(...val.map(String));
      }
    }
  }

  // Use operationId as a consumer hint (common pattern: client method name)
  if (operation.operationId) {
    consumers.push(operation.operationId);
  }

  return consumers;
}
