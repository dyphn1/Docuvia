const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");
const fs = require("fs");
// Resolve openapi path; if spec is 3.1.x, create a 3.0.3-compatible temp copy for orval
const originalOpenapiPath = path.resolve(__dirname, "openapi.yaml");
let openapiPath = originalOpenapiPath;
try {
  const raw = fs.readFileSync(originalOpenapiPath, "utf8");
  if (/^openapi:\s*3\.1/.test(raw)) {
    const tmpPath = path.resolve(__dirname, "openapi-3-0.generated.yaml");
    const replaced = raw.replace(/^openapi:\s*3\.1(?:\.0)?/, "openapi: 3.0.3");
    fs.writeFileSync(tmpPath, replaced, "utf8");
    openapiPath = tmpPath;
  }
} catch (e) {
  // fallback to original path; orval will surface errors if file missing
  openapiPath = originalOpenapiPath;
}

// Parse the OpenAPI YAML and normalize JSON-Schema 2020/3.1 constructs
// into OpenAPI 3.0-compatible shapes (e.g., type arrays -> type + nullable)
try {
  const yaml = require("js-yaml");
  const spec = yaml.load(fs.readFileSync(openapiPath, "utf8"));

  // downgrade openapi version if present
  if (spec && typeof spec === "object") {
    if (spec.openapi && String(spec.openapi).startsWith("3.1")) spec.openapi = "3.0.3";

    const normalize = (node) => {
      if (!node || typeof node !== "object") return;
      // normalize type arrays
      if (Array.isArray(node.type)) {
        const types = node.type;
        // handle nullable shorthand ["string","null"] -> type: string + nullable: true
        if (types.includes("null")) {
          const nonNull = types.filter((t) => t !== "null");
          if (nonNull.length === 1) {
            node.type = nonNull[0];
            node.nullable = true;
          } else if (nonNull.length > 1) {
            // convert to oneOf for multiple non-null types
            node.oneOf = nonNull.map((t) => ({ type: t }));
            delete node.type;
            node.nullable = true;
          } else {
            // only null -> keep as string nullable
            node.type = "string";
            node.nullable = true;
          }
        } else {
          // convert multiple types into oneOf
          node.oneOf = types.map((t) => ({ type: t }));
          delete node.type;
        }
      }

      // recurse
      for (const k of Object.keys(node)) {
        normalize(node[k]);
      }
    };

    normalize(spec);

    const bundlePath = path.resolve(__dirname, "openapi.orval.json");
    fs.writeFileSync(bundlePath, JSON.stringify(spec), "utf8");
    openapiPath = bundlePath;
  }
} catch (e) {
  // If anything fails, silently fall back to original openapiPath
}

const titleTransformer = (config) => {
  config.info ||= {};
  config.info.title = "Api";
  return config;
};

module.exports = {
  "api-client-react": {
    input: {
      target: openapiPath,
      transformer: titleTransformer,
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: openapiPath,
      transformer: titleTransformer,
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
};
