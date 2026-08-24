import { describe, it, expect } from "vitest";
import type { Node } from "web-tree-sitter";
import { parseImportDescriptors, buildScopeMap } from "./edge-computer.js";

/**
 * Minimal fake tree-sitter Node: parseImportDescriptors/buildScopeMap only ever call
 * `.type`, `.text`, `.descendantsOfType(type)`, `.childForFieldName(field)`, and
 * `.namedChildren` on the nodes they're handed — no other web-tree-sitter API surface is
 * used, so hand-built fixtures exercising exactly those calls are sufficient (and avoid the
 * cost/flakiness of loading real WASM grammars, plus the circular-dependency issue of
 * depending on @workspace/plugins-ast from @workspace/ast-core just for a test).
 */
interface FakeSpec {
  type: string;
  text?: string;
  descendants?: Record<string, FakeSpec[]>;
  fields?: Record<string, FakeSpec | undefined>;
  namedChildren?: FakeSpec[];
}

function makeNode(spec: FakeSpec): Node {
  const node = {
    type: spec.type,
    text: spec.text ?? "",
    descendantsOfType: (t: string) =>
      (spec.descendants?.[t] ?? []).map(makeNode),
    childForFieldName: (f: string) => {
      const child = spec.fields?.[f];
      return child ? makeNode(child) : undefined;
    },
    get namedChildren() {
      return (spec.namedChildren ?? []).map(makeNode);
    },
  };
  return node as unknown as Node;
}

describe("parseImportDescriptors", () => {
  it("TS named import: import { helper } from './b'", () => {
    const spec: FakeSpec = {
      type: "import_statement",
      descendants: {
        string: [{ type: "string", text: "'./b'" }],
        namespace_import: [],
        named_imports: [
          {
            type: "named_imports",
            descendants: {
              import_specifier: [
                {
                  type: "import_specifier",
                  fields: { name: { type: "identifier", text: "helper" } },
                },
              ],
            },
          },
        ],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      { localName: "helper", originalName: "helper", modulePath: "./b" },
    ]);
  });

  it("TS named import with alias: import { A as B } from 'bar'", () => {
    const spec: FakeSpec = {
      type: "import_statement",
      descendants: {
        string: [{ type: "string", text: "'bar'" }],
        namespace_import: [],
        named_imports: [
          {
            type: "named_imports",
            descendants: {
              import_specifier: [
                {
                  type: "import_specifier",
                  fields: {
                    name: { type: "identifier", text: "A" },
                    alias: { type: "identifier", text: "B" },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      { localName: "B", originalName: "A", modulePath: "bar" },
    ]);
  });

  it("TS namespace import: import * as NS from 'bar'", () => {
    const spec: FakeSpec = {
      type: "import_statement",
      descendants: {
        string: [{ type: "string", text: "'bar'" }],
        namespace_import: [
          {
            type: "namespace_import",
            descendants: { identifier: [{ type: "identifier", text: "NS" }] },
          },
        ],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      { localName: "NS", originalName: "*", modulePath: "bar" },
    ]);
  });

  it("TS barrel re-export: export { helper } from './deep/util' yields an import descriptor for the re-exported name (issue #192 gap 2)", () => {
    const spec: FakeSpec = {
      type: "export_statement",
      fields: { source: { type: "string", text: '"../deep/util"' } },
      descendants: {
        export_clause: [
          {
            type: "export_clause",
            descendants: {
              export_specifier: [
                {
                  type: "export_specifier",
                  fields: {
                    name: {
                      type: "identifier",
                      text: "evalChainHelper",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      {
        localName: "evalChainHelper",
        originalName: "evalChainHelper",
        modulePath: "../deep/util",
        viaReexport: true,
      },
    ]);
  });

  it("TS barrel re-export with alias: export { A as B } from './x' maps the outward-facing alias B to the original name A", () => {
    const spec: FakeSpec = {
      type: "export_statement",
      fields: { source: { type: "string", text: "'./x'" } },
      descendants: {
        export_clause: [
          {
            type: "export_clause",
            descendants: {
              export_specifier: [
                {
                  type: "export_specifier",
                  fields: {
                    name: { type: "identifier", text: "A" },
                    alias: { type: "identifier", text: "B" },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      {
        localName: "B",
        originalName: "A",
        modulePath: "./x",
        viaReexport: true,
      },
    ]);
  });

  it("TS plain local export (no source clause) produces no descriptor -- only re-exports are dependency edges", () => {
    const spec: FakeSpec = {
      type: "export_statement",
      descendants: {
        export_clause: [
          {
            type: "export_clause",
            descendants: {
              export_specifier: [
                {
                  type: "export_specifier",
                  fields: { name: { type: "identifier", text: "localThing" } },
                },
              ],
            },
          },
        ],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([]);
  });

  it("TS default import: import Foo from 'bar'", () => {
    const spec: FakeSpec = {
      type: "import_statement",
      descendants: {
        string: [{ type: "string", text: "'bar'" }],
        namespace_import: [],
        named_imports: [],
        identifier: [{ type: "identifier", text: "Foo" }],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      { localName: "Foo", originalName: "*", modulePath: "bar" },
    ]);
  });

  it("Python: from x import y", () => {
    const spec: FakeSpec = {
      type: "import_from_statement",
      fields: {
        module_name: { type: "dotted_name", text: "x" },
        name: { type: "identifier", text: "y" },
      },
      descendants: { wildcard_import: [] },
      namedChildren: [{ type: "identifier", text: "y" }],
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      { localName: "y", originalName: "y", modulePath: "x" },
    ]);
  });

  it("Rust: use foo::bar as baz", () => {
    const spec: FakeSpec = {
      type: "use_declaration",
      fields: {
        argument: {
          type: "use_as_clause",
          fields: {
            path: { type: "scoped_identifier", text: "foo::bar" },
            alias: { type: "identifier", text: "baz" },
          },
        },
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      { localName: "baz", originalName: "*", modulePath: "foo::bar" },
    ]);
  });

  it('Go: import "pkg"', () => {
    const spec: FakeSpec = {
      type: "import_declaration",
      descendants: {
        import_spec_list: [
          {
            type: "import_spec_list",
            descendants: {
              import_spec: [
                {
                  type: "import_spec",
                  fields: {
                    path: { type: "interpreted_string_literal", text: '"pkg"' },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    const result = parseImportDescriptors([makeNode(spec)]);
    expect(result).toEqual([
      { localName: "pkg", originalName: "*", modulePath: "pkg" },
    ]);
  });
});

describe("buildScopeMap (behavior-preserving wrapper over parseImportDescriptors)", () => {
  it("encodes named-import descriptors as `${modulePath}::${originalName}` (matches original hand-written implementation's output)", () => {
    const named: FakeSpec = {
      type: "import_statement",
      descendants: {
        string: [{ type: "string", text: "'./b'" }],
        namespace_import: [],
        named_imports: [
          {
            type: "named_imports",
            descendants: {
              import_specifier: [
                {
                  type: "import_specifier",
                  fields: { name: { type: "identifier", text: "helper" } },
                },
              ],
            },
          },
        ],
      },
    };
    const namespaceImport: FakeSpec = {
      type: "import_statement",
      descendants: {
        string: [{ type: "string", text: "'bar'" }],
        namespace_import: [
          {
            type: "namespace_import",
            descendants: { identifier: [{ type: "identifier", text: "NS" }] },
          },
        ],
      },
    };

    const map = buildScopeMap([makeNode(named), makeNode(namespaceImport)], "");

    // Old implementation: named import -> `${srcText}::${importedName}`; namespace -> srcText.
    expect(map.get("helper")).toBe("./b::helper");
    expect(map.get("NS")).toBe("bar");
    expect(map.size).toBe(2);
  });
});
