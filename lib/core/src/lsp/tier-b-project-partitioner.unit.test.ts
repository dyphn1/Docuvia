import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  TIER_B_LANGUAGE_IDS,
  type TierBLanguageId,
} from "@workspace/contracts";
import { partitionTierBBucket } from "./tier-b-project-partitioner.js";

function makeWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-tierb-part-"));
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return dir;
}

const workspaces: string[] = [];
function withWorkspace(files: Record<string, string>): string {
  const dir = makeWorkspace(files);
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("partitionTierBBucket() (PRJ-001 project-aware partition)", () => {
  it("maps each file to its nearest owning project and groups Rust workspace crates", () => {
    const root = withWorkspace({
      "Cargo.toml": '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
      "src/main.rs": "",
      "crates/a/Cargo.toml": '[package]\nname = "a"\nversion = "0.1.0"\n',
      "crates/a/src/lib.rs": "",
      "crates/b/Cargo.toml":
        '[package]\nname = "b"\n[dependencies]\na = { path = "../a" }\n',
      "crates/b/src/lib.rs": "",
    });

    const partition = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.RUST,
      files: ["src/main.rs", "crates/a/src/lib.rs", "crates/b/src/lib.rs"],
    });

    expect(partition.fileToProjectRoot.get("src/main.rs")).toBe(
      path.resolve(root),
    );
    expect(partition.fileToProjectRoot.get("crates/a/src/lib.rs")).toBe(
      path.join(root, "crates", "a"),
    );
    expect(partition.fileToProjectRoot.get("crates/b/src/lib.rs")).toBe(
      path.join(root, "crates", "b"),
    );

    const roots = partition.groups.map((g) => g.root);
    expect(roots).toEqual([
      path.join(root, "crates", "a"),
      path.join(root, "crates", "b"),
      path.resolve(root),
    ]);
  });

  it("falls back to the workspace root for files with no owning marker", () => {
    const root = withWorkspace({
      "x.rs": "",
      "sub/y.rs": "",
    });

    const partition = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.RUST,
      files: ["x.rs", "sub/y.rs"],
    });

    expect(partition.fileToProjectRoot.get("x.rs")).toBe(path.resolve(root));
    expect(partition.fileToProjectRoot.get("sub/y.rs")).toBe(
      path.resolve(root),
    );
    expect(partition.groups).toHaveLength(1);
    expect(partition.groups[0].root).toBe(path.resolve(root));
    expect(partition.groups[0].files).toEqual(["x.rs", "sub/y.rs"]);
  });

  it("orders dependency projects before dependents (bottom-up, PRJ-003)", () => {
    const root = withWorkspace({
      "Cargo.toml": '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
      "src/main.rs": "",
      "crates/a/Cargo.toml": '[package]\nname = "a"\n',
      "crates/a/src/lib.rs": "",
      "crates/b/Cargo.toml":
        '[package]\nname = "b"\n[dependencies]\na = { path = "../a" }\n',
      "crates/b/src/lib.rs": "",
    });

    const partition = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.RUST,
      files: ["crates/b/src/lib.rs", "crates/a/src/lib.rs", "src/main.rs"],
    });

    const groupByRoot = new Map(partition.groups.map((g) => [g.root, g]));
    expect(groupByRoot.get(path.join(root, "crates", "a"))?.deps).toEqual([]);
    expect(groupByRoot.get(path.join(root, "crates", "b"))?.deps).toContain(
      path.join(root, "crates", "a"),
    );
    expect(groupByRoot.get(path.resolve(root))?.deps).toEqual(
      expect.arrayContaining([
        path.join(root, "crates", "a"),
        path.join(root, "crates", "b"),
      ]),
    );

    // b depends on a, root depends on both -> a, b, root.
    expect(partition.groups.map((g) => g.root)).toEqual([
      path.join(root, "crates", "a"),
      path.join(root, "crates", "b"),
      path.resolve(root),
    ]);
  });

  it("terminates deterministically on a dependency cycle (path-order tiebreak)", () => {
    const root = withWorkspace({
      "Cargo.toml": "[workspace]\n",
      "a/Cargo.toml": '[dependencies]\nb = { path = "../b" }\n',
      "a/src/lib.rs": "",
      "b/Cargo.toml": '[dependencies]\na = { path = "../a" }\n',
      "b/src/lib.rs": "",
    });

    const first = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.RUST,
      files: ["a/src/lib.rs", "b/src/lib.rs"],
    });
    const second = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.RUST,
      files: ["b/src/lib.rs", "a/src/lib.rs"],
    });

    const expectedOrder = [path.join(root, "a"), path.join(root, "b")];
    expect(first.groups.map((g) => g.root)).toEqual(expectedOrder);
    expect(second.groups.map((g) => g.root)).toEqual(expectedOrder);
  });

  it("expands TypeScript workspaces and honors tsconfig references", () => {
    const root = withWorkspace({
      "package.json": JSON.stringify({
        name: "root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "tsconfig.json": "{}",
      "packages/a/package.json": JSON.stringify({ name: "a" }),
      "packages/a/tsconfig.json": JSON.stringify({
        references: [{ path: "../b" }],
      }),
      "packages/a/src/index.ts": "",
      "packages/b/package.json": JSON.stringify({ name: "b" }),
      "packages/b/src/index.ts": "",
      "src/index.ts": "",
    });

    const partition = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.TYPESCRIPT,
      files: [
        "packages/a/src/index.ts",
        "packages/b/src/index.ts",
        "src/index.ts",
      ],
    });

    const groupByRoot = new Map(partition.groups.map((g) => [g.root, g]));
    expect(groupByRoot.get(path.join(root, "packages", "a"))?.deps).toContain(
      path.join(root, "packages", "b"),
    );
    expect(groupByRoot.get(path.resolve(root))?.deps).toEqual(
      expect.arrayContaining([
        path.join(root, "packages", "a"),
        path.join(root, "packages", "b"),
      ]),
    );
    expect(partition.groups.map((g) => g.root)).toEqual([
      path.join(root, "packages", "b"),
      path.join(root, "packages", "a"),
      path.resolve(root),
    ]);
  });

  it("orders Go submodules ahead of the module that replaces into them", () => {
    const root = withWorkspace({
      "go.mod":
        "module example.com/root\n\nrequire example.com/root/sub v0.0.0\n\nreplace example.com/root/sub => ./sub\n",
      "main.go": "",
      "sub/go.mod": "module example.com/root/sub\n",
      "sub/lib.go": "",
    });

    const partition = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.GO,
      files: ["main.go", "sub/lib.go"],
    });

    expect(partition.groups.map((g) => g.root)).toEqual([
      path.join(root, "sub"),
      path.resolve(root),
    ]);
  });

  it("orders C# projects after the projects they reference", () => {
    const root = withWorkspace({
      "A/A.csproj": "",
      "A/Program.cs": "",
      "B/B.csproj": '<ProjectReference Include="..\\A\\A.csproj" />\n',
      "B/Util.cs": "",
    });

    const partition = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.CSHARP,
      files: ["A/Program.cs", "B/Util.cs"],
    });

    expect(partition.fileToProjectRoot.get("A/Program.cs")).toBe(
      path.join(root, "A"),
    );
    expect(partition.fileToProjectRoot.get("B/Util.cs")).toBe(
      path.join(root, "B"),
    );
    expect(partition.groups.map((g) => g.root)).toEqual([
      path.join(root, "A"),
      path.join(root, "B"),
    ]);
  });

  it("keeps files grouped with their owning project regardless of input order", () => {
    const root = withWorkspace({
      "Cargo.toml": "[workspace]\n",
      "a/Cargo.toml": "[package]\n",
      "a/src/lib.rs": "",
      "b/Cargo.toml": "[package]\n",
      "b/src/lib.rs": "",
    });

    const shuffled = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.RUST,
      files: ["b/src/lib.rs", "a/src/lib.rs"],
    });
    const inOrder = partitionTierBBucket({
      workspaceRoot: root,
      languageId: TIER_B_LANGUAGE_IDS.RUST,
      files: ["a/src/lib.rs", "b/src/lib.rs"],
    });

    expect(shuffled.groups.map((g) => g.root)).toEqual(
      inOrder.groups.map((g) => g.root),
    );
    expect(shuffled.groups.find((g) => g.root.endsWith("a"))?.files).toEqual([
      "a/src/lib.rs",
    ]);
  });
});

describe("partitionTierBBucket() across language markers", () => {
  const cases: Array<{
    languageId: TierBLanguageId;
    markerFiles: string[];
    files: string[];
  }> = [
    {
      languageId: TIER_B_LANGUAGE_IDS.PYTHON,
      markerFiles: ["pyproject.toml"],
      files: ["app/foo.py", "app/bar.py"],
    },
    {
      languageId: TIER_B_LANGUAGE_IDS.JAVA,
      markerFiles: ["pom.xml"],
      files: ["src/Main.java"],
    },
    {
      languageId: TIER_B_LANGUAGE_IDS.CPP,
      markerFiles: ["CMakeLists.txt"],
      files: ["src/main.cpp"],
    },
    {
      languageId: TIER_B_LANGUAGE_IDS.PHP,
      markerFiles: ["composer.json"],
      files: ["src/index.php"],
    },
    {
      languageId: TIER_B_LANGUAGE_IDS.RUBY,
      markerFiles: ["Gemfile"],
      files: ["lib/app.rb"],
    },
  ];

  it.each(cases)(
    "uses $languageId project markers as the file boundary",
    ({ languageId, markerFiles, files }) => {
      const root = withWorkspace({
        "Cargo.toml": "[workspace]\n",
        [path.join("proj", markerFiles[0])]: "",
        [path.join("proj", files[0])]: "",
      });

      const partition = partitionTierBBucket({
        workspaceRoot: root,
        languageId,
        files: [path.join("proj", files[0])],
      });

      expect(partition.fileToProjectRoot.get(path.join("proj", files[0]))).toBe(
        path.join(root, "proj"),
      );
    },
  );
});
