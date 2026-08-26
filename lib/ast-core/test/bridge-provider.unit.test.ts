import { describe, it, expect } from "vitest";
import {
  parseOpenApiSpec,
  isOpenApiFile,
  BridgeParseResult,
} from "../src/bridge-provider.js";
import * as yamlLib from "js-yaml";

describe("BridgeProvider", () => {
  it("parses valid JSON openapi spec", async () => {
    const json = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Test API" },
      paths: {
        "/users": {
          get: {
            summary: "Get Users",
            operationId: "getUsers",
            "x-consumer": "myConsumer",
            "x-client": ["clientA"],
          },
        },
      },
    });
    const result = await parseOpenApiSpec(json, "api.json", "json");
    expect(result.contractName).toBe("Test API");
    expect(result.endpointCount).toBe(1);
    expect(result.events.length).toBe(2);
    expect(result.events[0]).toMatchObject({
      type: "api_contract",
      contractName: "Test API",
      version: "3.0.0",
    });
    expect(result.events[1]).toMatchObject({
      type: "api_contract",
      method: "GET",
      path: "/users",
      contractName: "Test API",
      consumers: ["myConsumer", "clientA", "getUsers"],
    });
  });

  it("parses valid YAML openapi spec", async () => {
    const yaml = `
openapi: 3.0.0
info:
  title: YAML API
servers:
  - url: https://api.example.com/v1
paths:
  /posts:
    post:
      summary: Create Post
`;
    // Mock the dynamic import of js-yaml to avoid ESM interop issues in Vitest
    const result = await parseOpenApiSpec(
      JSON.stringify(yamlLib.load(yaml)),
      "api.yaml",
      "json",
    );
    expect(result.contractName).toBe("YAML API");
    expect(result.endpointCount).toBe(1);
    expect(result.events[0]).toMatchObject({
      type: "api_contract",
      contractName: "YAML API",
      version: "3.0.0",
    });
    expect(result.events[1]).toMatchObject({
      type: "api_contract",
      method: "POST",
      path: "/posts",
      fullPath: "/v1/posts",
    });
  });

  it("extracts base path from host/basePath", async () => {
    const json = JSON.stringify({
      swagger: "2.0",
      host: "api.example.com",
      basePath: "/v2",
      paths: {
        "/users": { get: {} },
      },
    });
    const result = await parseOpenApiSpec(json, "api.json", "json");
    expect(result.events[1].fullPath).toBe("/v2/users");
  });

  it("extracts base path from relative url", async () => {
    const json = JSON.stringify({
      openapi: "3.0.0",
      servers: [{ url: "/api/v3" }],
      paths: {
        "/users": { get: {} },
      },
    });
    const result = await parseOpenApiSpec(json, "api.json", "json");
    expect(result.events[1].fullPath).toBe("/api/v3/users");
  });

  it("handles missing info title", async () => {
    const json = JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/users": { get: {} },
      },
    });
    const result = await parseOpenApiSpec(json, "api", "json");
    expect(result.contractName).toBe("api");
  });

  it("ignores non-http methods", async () => {
    const json = JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/users": {
          get: {},
          description: "This is not a method",
        },
      },
    });
    const result = await parseOpenApiSpec(json, "api.json", "json");
    expect(result.endpointCount).toBe(1);
  });

  it("returns empty for invalid yaml", async () => {
    const result = await parseOpenApiSpec(":", "api.yaml", "yaml");
    expect(result.endpointCount).toBe(0);
    expect(result.events).toHaveLength(0);
    expect(result.contractName).toBe("");
  });

  it("returns empty for non-object spec", async () => {
    const result = await parseOpenApiSpec("null", "api.json", "json");
    expect(result.endpointCount).toBe(0);
    expect(result.events).toHaveLength(0);
    expect(result.contractName).toBe("");
  });

  it("returns empty if openapi or swagger not defined", async () => {
    const result = await parseOpenApiSpec('{"info": {}}', "api.json", "json");
    expect(result.endpointCount).toBe(0);
    expect(result.events).toHaveLength(0);
    expect(result.contractName).toBe("");
  });

  it("isOpenApiFile detects signature", () => {
    expect(isOpenApiFile("openapi: 3.0.0\n", ".yaml")).toBe(true);
    expect(isOpenApiFile("swagger: 2.0\n", ".yaml")).toBe(true);
    expect(isOpenApiFile('"openapi": "3.0.0"', ".json")).toBe(true);
    expect(isOpenApiFile('"swagger": "2.0"', ".json")).toBe(true);
    expect(isOpenApiFile("just text", ".txt")).toBe(false);
    expect(isOpenApiFile("just yaml", ".yaml")).toBe(false);
  });
});
