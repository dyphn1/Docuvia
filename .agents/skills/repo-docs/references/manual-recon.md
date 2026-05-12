# Manual Recon Steps

Use these bash commands when `recon.py` is not available.
Run each block and collect the output before generating docs.

## 1. Directory tree

```bash
# macOS / Linux (depth 3, ignoring noise)
find . -maxdepth 3 \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/__pycache__/*' \
  -not -path '*/.venv/*' \
  -not -path '*/dist/*' \
  -not -path '*/build/*' \
  -not -path '*/.next/*' \
  -not -path '*/target/*' \
  | sort
```

## 2. Project identity

```bash
# Node
cat package.json | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('name:', d.get('name'))
print('description:', d.get('description'))
print('version:', d.get('version'))
print('license:', d.get('license'))
print('scripts:', list(d.get('scripts',{}).keys()))
print('engines:', d.get('engines'))
"

# Python
cat pyproject.toml 2>/dev/null || cat setup.py 2>/dev/null

# Rust
cat Cargo.toml 2>/dev/null

# Go
cat go.mod 2>/dev/null
```

## 3. Package manager

```bash
ls package-lock.json yarn.lock pnpm-lock.yaml bun.lockb 2>/dev/null
```

## 4. Scripts / Makefile

```bash
# Node scripts
cat package.json | python3 -c "
import json,sys; d=json.load(sys.stdin)
for k,v in d.get('scripts',{}).items(): print(f'  {k}: {v}')
"

# Makefile targets
grep -E '^[a-zA-Z_-]+:' Makefile 2>/dev/null | head -30
```

## 5. Runtime versions

```bash
cat .nvmrc 2>/dev/null
cat .node-version 2>/dev/null
cat .python-version 2>/dev/null
cat .tool-versions 2>/dev/null
```

## 6. CI commands

```bash
grep -h "run:" .github/workflows/*.yml 2>/dev/null | head -30
```

## 7. Existing docs

```bash
cat README.md 2>/dev/null
cat AGENT.md 2>/dev/null
```

## 8. Key config files (check presence)

```bash
ls \
  jest.config.* vitest.config.* \
  .eslintrc* eslint.config.* \
  .prettierrc* prettier.config.* \
  ruff.toml .ruff.toml \
  turbo.json nx.json pnpm-workspace.yaml \
  Dockerfile docker-compose.yml \
  2>/dev/null
```

## 9. Dependency hints (detect framework)

```bash
# Node — check for common frameworks
cat package.json | python3 -c "
import json,sys; d=json.load(sys.stdin)
all_deps = {**d.get('dependencies',{}), **d.get('devDependencies',{})}
frameworks = ['next','nuxt','remix','astro','vite','express','fastify','nestjs',
              'react','vue','svelte','solid','angular','electron','tauri']
found = [f for f in frameworks if f in all_deps or f+'js' in all_deps]
print('detected frameworks:', found)
"
```
