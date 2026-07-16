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
import { AstEventType } from "./constants/ast-event-constants.js";

export const SpecFormat = {
  YAML: "yaml",
  JSON: "json",
} as const;
export type SpecFormat = (typeof SpecFormat)[keyof typeof SpecFormat];

/** File extensions recognized as candidate OpenAPI/Swagger spec files. */
export const OPENAPI_SPEC_EXTENSIONS = [".yaml", ".yml", ".json"] as const;

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
] as const;

/** Signature key prefixes checked when sniffing a file for an OpenAPI/Swagger spec. */
const OPENAPI_SIGNATURE_PREFIXES = [
  "openapi:",
  "swagger:",
  '"openapi":',
  '"swagger":',
] as const;

/** OpenAPI vendor-extension key prefixes used to hint cross-language consumers. */
const ConsumerExtensionKeyPrefixes = {
  CONSUMER: "x-consumer",
  CLIENT: "x-client",
} as const;

/** Marks the root of a URL path when deriving an OpenAPI spec's base path. */
const ROOT_URL_PATH = "/";

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
  format: SpecFormat,
): Promise<BridgeParseResult> {
  let spec: any;

  try {
    if (format === SpecFormat.YAML) {
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

  const contractName =
    (spec.info && spec.info.title) ||
    filePath.replace(/\.(yaml|yml|json)$/, "");

  const events: AstEvent[] = [];
  const paths = spec.paths || {};

  // Emit a top-level contract event
  events.push({
    type: AstEventType.API_CONTRACT,
    contractName,
    version: isOpenApi3 ? spec.openapi : spec.swagger,
    description: spec.info?.description || "",
    filePath,
    basePath: extractBasePath(spec),
  });

  // Emit one event per endpoint
  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as any)[method];
      if (!operation || typeof operation !== "object") continue;

      const summary =
        operation.summary ||
        operation.description ||
        `${method.toUpperCase()} ${routePath}`;
      const operationId = operation.operationId || null;
      const tags = Array.isArray(operation.tags) ? operation.tags : [];

      events.push({
        type: AstEventType.API_CONTRACT,
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
    endpointCount: events.filter(
      (e) => e.type === AstEventType.API_CONTRACT && e.method,
    ).length,
  };
}

/**
 * Detect if a file is likely an OpenAPI spec by inspecting its content.
 * Fast path: check for 'openapi' or 'swagger' key at root level.
 */
export function isOpenApiFile(content: string, ext: string): boolean {
  if (
    !(OPENAPI_SPEC_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())
  ) {
    return false;
  }

  // Quick scan for the signature key (faster than full parse)
  const lines = content.split("\n", 20);
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      OPENAPI_SIGNATURE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
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
        return u.pathname === ROOT_URL_PATH ? "" : u.pathname;
      } catch {
        // Relative path
        return url.startsWith(ROOT_URL_PATH) ? url : "";
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
    if (
      key.startsWith(ConsumerExtensionKeyPrefixes.CONSUMER) ||
      key.startsWith(ConsumerExtensionKeyPrefixes.CLIENT)
    ) {
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
