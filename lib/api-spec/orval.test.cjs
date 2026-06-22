const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");
const openapiPath = path.resolve(__dirname, "openapi-3-0.yaml");

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
      clean: false,
      prettier: false,
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
      clean: false,
      prettier: false,
    },
  },
};
