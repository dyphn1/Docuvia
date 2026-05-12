#!/usr/bin/env python3
"""
recon.py — Gather repo context for repo-docs skill.
Outputs a JSON summary to stdout.

Usage: python recon.py <repo_root>
"""

import json
import os
import sys
import re
from pathlib import Path

# Dirs/files to always ignore in tree output
IGNORE = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", ".nuxt", "target", "vendor",
    ".mypy_cache", ".ruff_cache", ".pytest_cache", "coverage",
    ".turbo", ".vercel", ".terraform", "*.egg-info",
}

CONFIG_FILES = [
    "package.json", "pyproject.toml", "setup.py", "setup.cfg",
    "Cargo.toml", "go.mod", "Makefile", "Dockerfile",
    "docker-compose.yml", "docker-compose.yaml",
    ".nvmrc", ".node-version", ".python-version",
    "turbo.json", "nx.json", "pnpm-workspace.yaml",
    "lerna.json", "rush.json",
]

CI_DIR = ".github/workflows"


def should_ignore(name: str) -> bool:
    if name.startswith(".") and name not in {".nvmrc", ".node-version", ".python-version"}:
        return True
    return name in IGNORE or name.endswith(".egg-info")


def build_tree(root: Path, depth: int = 3, current: int = 0) -> list:
    if current >= depth:
        return []
    items = []
    try:
        entries = sorted(root.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except PermissionError:
        return []
    for entry in entries:
        if should_ignore(entry.name):
            continue
        if entry.is_dir():
            children = build_tree(entry, depth, current + 1)
            items.append({"name": entry.name, "type": "dir", "children": children})
        else:
            items.append({"name": entry.name, "type": "file"})
    return items


def read_file_safe(path: Path, max_bytes: int = 8000) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:max_bytes]
    except Exception:
        return None


def detect_languages(root: Path) -> list[str]:
    ext_map = {
        ".ts": "TypeScript", ".tsx": "TypeScript",
        ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
        ".py": "Python",
        ".rs": "Rust",
        ".go": "Go",
        ".java": "Java",
        ".kt": "Kotlin",
        ".rb": "Ruby",
        ".php": "PHP",
        ".cs": "C#",
        ".cpp": "C++", ".cc": "C++", ".cxx": "C++",
        ".c": "C",
        ".swift": "Swift",
        ".dart": "Dart",
        ".ex": "Elixir", ".exs": "Elixir",
    }
    counts: dict[str, int] = {}
    for f in root.rglob("*"):
        if any(part in IGNORE or part.startswith(".") for part in f.parts):
            continue
        lang = ext_map.get(f.suffix)
        if lang:
            counts[lang] = counts.get(lang, 0) + 1
    return sorted(counts, key=lambda l: -counts[l])


def extract_package_json(root: Path) -> dict:
    p = root / "package.json"
    if not p.exists():
        return {}
    try:
        import json as _json
        data = _json.loads(p.read_text())
        return {
            "name": data.get("name"),
            "description": data.get("description"),
            "version": data.get("version"),
            "license": data.get("license"),
            "scripts": data.get("scripts", {}),
            "engines": data.get("engines", {}),
            "workspaces": data.get("workspaces"),
            "main_deps": list(data.get("dependencies", {}).keys())[:20],
            "dev_deps": list(data.get("devDependencies", {}).keys())[:20],
        }
    except Exception:
        return {}


def detect_package_manager(root: Path) -> str | None:
    if (root / "pnpm-lock.yaml").exists():
        return "pnpm"
    if (root / "yarn.lock").exists():
        return "yarn"
    if (root / "package-lock.json").exists():
        return "npm"
    if (root / "bun.lockb").exists() or (root / "bun.lock").exists():
        return "bun"
    return None


def detect_test_framework(root: Path, pkg: dict) -> str | None:
    dev_deps = pkg.get("dev_deps", []) + pkg.get("main_deps", [])
    scripts = pkg.get("scripts", {})
    if "jest" in dev_deps or "jest" in scripts.get("test", ""):
        return "jest"
    if "vitest" in dev_deps or "vitest" in scripts.get("test", ""):
        return "vitest"
    if "pytest" in str(read_file_safe(root / "pyproject.toml") or ""):
        return "pytest"
    if (root / "pytest.ini").exists() or (root / "conftest.py").exists():
        return "pytest"
    return None


def read_ci_commands(root: Path) -> list[str]:
    ci_dir = root / CI_DIR
    if not ci_dir.exists():
        return []
    commands = []
    for yml in ci_dir.glob("*.yml"):
        content = read_file_safe(yml) or ""
        # Extract run: lines
        matches = re.findall(r"run:\s*\|?\s*(.+)", content)
        commands.extend(m.strip() for m in matches if m.strip())
    return commands[:30]


def main():
    repo_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

    if not repo_root.exists():
        print(json.dumps({"error": f"Path not found: {repo_root}"}))
        sys.exit(1)

    pkg = extract_package_json(repo_root)
    languages = detect_languages(repo_root)
    pm = detect_package_manager(repo_root)
    test_fw = detect_test_framework(repo_root, pkg)

    # Read all relevant config files
    configs = {}
    for cf in CONFIG_FILES:
        p = repo_root / cf
        if p.exists():
            configs[cf] = read_file_safe(p)

    # Read existing docs
    existing_readme = read_file_safe(repo_root / "README.md")
    existing_agent = read_file_safe(repo_root / "AGENT.md")

    ci_commands = read_ci_commands(repo_root)

    result = {
        "repo_root": str(repo_root),
        "project_name": pkg.get("name") or repo_root.name,
        "description": pkg.get("description"),
        "version": pkg.get("version"),
        "license": pkg.get("license"),
        "languages": languages,
        "package_manager": pm,
        "test_framework": test_fw,
        "scripts": pkg.get("scripts", {}),
        "engines": pkg.get("engines", {}),
        "workspaces": pkg.get("workspaces"),
        "main_deps": pkg.get("main_deps", []),
        "dev_deps": pkg.get("dev_deps", []),
        "tree": build_tree(repo_root),
        "configs": configs,
        "ci_commands": ci_commands,
        "existing_readme": existing_readme,
        "existing_agent": existing_agent,
        "has_readme": (repo_root / "README.md").exists(),
        "has_agent": (repo_root / "AGENT.md").exists(),
        "has_ci": (repo_root / ".github" / "workflows").exists(),
        "has_docker": (repo_root / "Dockerfile").exists(),
        "has_makefile": (repo_root / "Makefile").exists(),
        "has_contributing": (repo_root / "CONTRIBUTING.md").exists(),
        "has_license": (repo_root / "LICENSE").exists() or (repo_root / "LICENSE.md").exists(),
    }

    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
