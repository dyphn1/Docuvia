import { describe, it, expect } from "vitest";
import {
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  cConfig,
  cppConfig,
  csharpConfig,
  goConfig,
  javaConfig,
  phpConfig,
  rubyConfig,
  rustConfig,
} from "../src/languages/index.js";

describe("Language Configurations", () => {
  const configs = [
    { name: "TypeScript", config: typescriptConfig },
    { name: "JavaScript", config: javascriptConfig },
    { name: "Python", config: pythonConfig },
    { name: "C", config: cConfig },
    { name: "C++", config: cppConfig },
    { name: "C#", config: csharpConfig },
    { name: "Go", config: goConfig },
    { name: "Java", config: javaConfig },
    { name: "PHP", config: phpConfig },
    { name: "Ruby", config: rubyConfig },
    { name: "Rust", config: rustConfig },
  ];

  configs.forEach(({ name, config }) => {
    it(`should have valid configuration for ${name}`, () => {
      expect(config).toBeDefined();
      expect(Array.isArray(config.extensions)).toBe(true);
      expect(config.extensions.length).toBeGreaterThan(0);
      expect(typeof config.wasm_file).toBe("string");
      expect(config.queries).toBeDefined();
    });
  });
});
