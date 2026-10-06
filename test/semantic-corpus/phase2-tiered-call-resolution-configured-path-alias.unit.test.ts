import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { configuredPathAliasesFromSource } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-source.mjs";

function parse(code: string) {
  return configuredPathAliasesFromSource(
    code,
    createHash("sha256").update(code).digest("hex"),
  );
}

describe("source-bound configured path alias facts", () => {
  it("[happy] records exact configuration hash and normalized optional fields", () => {
    const code = JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    });
    expect(parse(code)).toEqual({
      configurationFilePath: "tsconfig.json",
      sourceContentHash: createHash("sha256").update(code).digest("hex"),
      paths: { "@/*": ["./src/*"] },
      baseUrl: null,
      extends: [],
    });
    expect(
      parse(
        JSON.stringify({
          extends: "./base.json",
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
        }),
      ),
    ).toMatchObject({ baseUrl: ".", extends: ["./base.json"] });
  });
  it("[invalid-input] rejects stale bytes and malformed path fields", () => {
    const values = [
      null,
      [],
      {},
      { compilerOptions: { paths: { "@/*": "./src/*" } } },
      { compilerOptions: { paths: { "@/*": [42] } } },
      { extends: [42], compilerOptions: { paths: {} } },
    ];
    expect({
      valid: parse('{"compilerOptions":{"paths":{}}}'),
      stale: configuredPathAliasesFromSource("{}", "a".repeat(64)),
      malformed: values.map((value) => parse(JSON.stringify(value))),
    }).toStrictEqual({
      valid: {
        configurationFilePath: "tsconfig.json",
        sourceContentHash: createHash("sha256")
          .update('{"compilerOptions":{"paths":{}}}')
          .digest("hex"),
        paths: {},
        baseUrl: null,
        extends: [],
      },
      stale: undefined,
      malformed: [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    });
  });
  it("[error-handling] leaves JSONC or invalid configuration unavailable", () => {
    expect([
      parse('{"compilerOptions":{"paths":{}}}'),
      parse("{ // comment\n } "),
      parse("invalid"),
    ]).toStrictEqual([
      {
        configurationFilePath: "tsconfig.json",
        sourceContentHash: createHash("sha256")
          .update('{"compilerOptions":{"paths":{}}}')
          .digest("hex"),
        paths: {},
        baseUrl: null,
        extends: [],
      },
      undefined,
      undefined,
    ]);
  });
});
