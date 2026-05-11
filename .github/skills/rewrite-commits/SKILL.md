---
name: rewrite-commits
description: 'Rewrite commit messages in a given revision range to follow Conventional Commits (Angular style), then apply them to a new branch. Use when you need to clean up commit history for a range of commits.'
---

# Rewrite Commits to Conventional Commits

Analyze each commit in a **given revision range**, rewrite the commit message using **Conventional Commits (Angular style)** based on the actual diff content, and apply the result to a **new branch** — fully non-interactive.

---

## 📥 Required Inputs

Before starting, collect the following from the user:

| Parameter | Description | Example |
|---|---|---|
| `FROM_REVISION` | The **exclusive** base revision (not included in range) | `663386282993531e936b09f2a7e6a7b60a2f3290` |
| `TO_REVISION` | The **inclusive** tip revision (last commit to rewrite) | `5f07e2d2bb5805910669668a55b6fc5326cf39eb` |
| `BRANCH_NAME` | Name for the new branch to create | `rewrite-commits-branch` |

---

## 🔒 Critical Rules

- 🛑 **NEVER chain `git` commands using `&&`**. Execute commands one by one and wait for output.
- 🛑 **NEVER open interactive editors** (vim, nano, etc.). All commits must use `-m` flags only.
- 🛑 **NEVER amend without cherry-picking first**. Always `cherry-pick` → then `commit --amend`.
- ✅ **MUST read the actual diff** via `git show <hash>` before generating any commit message.
- ✅ If the target branch already exists, switch to `main`/`master` first, delete it, then recreate.

---

## Enforced Workflow

### Step 1: Verify Repository and Collect Commit List

1. Confirm we are in the correct Git repository:
   ```bash
   git --no-pager log --oneline -1
   ```

2. Get all commits in the range (oldest → newest):
   ```bash
   git --no-pager log --oneline <FROM_REVISION>..<TO_REVISION>
   ```

3. Note the full list of commit hashes to process.

---

### Step 2: Create the New Branch

1. Switch to a safe base branch first if needed:
   ```bash
   git checkout main
   ```

2. Delete the target branch if it already exists:
   ```bash
   git branch -D <BRANCH_NAME>
   ```

3. Create and switch to the new branch from `FROM_REVISION`:
   ```bash
   git checkout -b <BRANCH_NAME> <FROM_REVISION>
   ```

---

### Step 3: Process Each Commit (Repeat for Every Hash)

For **each** commit hash in the range, from oldest to newest:

#### 3a. Analyze the Diff

```bash
git --no-pager show --stat <COMMIT_HASH>
```

Then read the actual file-level changes:

```bash
git --no-pager show <COMMIT_HASH>
```

Focus on:
- Which files were **added** (`A`), **modified** (`M`), **deleted** (`D`), or **renamed** (`R`)
- The **content** of changes (new functions, new docs sections, config changes, etc.)
- The **scope**: which module, folder, or feature area was affected

#### 3b. Generate the Conventional Commit Message

Using the diff analysis, determine:

-   **`<type>`**: one of `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
-   **`<scope>`**: the most specific affected module/folder (e.g., `rag`, `skills`, `llm`, `tasks`)
-   **`<subject>`**: imperative, present tense summary of the primary change (≤50 chars, no period)
-   **`<body>`**: bullet-style explanation of key changes — what was added/removed/changed and why. Wrap at ~72 chars per line.
-   **`<footer>`**: only if there is a `BREAKING CHANGE` or issue reference

#### 3c. Apply the Commit

Cherry-pick the original commit to stage its changes:

```bash
git cherry-pick <COMMIT_HASH>
```

Then immediately amend with the new message (use `-m` twice for subject + body):

```bash
git --no-pager commit --amend -m "<type>(<scope>): <subject>" -m "<body>"
```

---

### Step 4: Verify Final Result

After all commits are processed:

```bash
git --no-pager log --oneline <BRANCH_NAME>
```

Display the final log so the user can confirm all messages are correct.

---

## 🧠 Commit Message Generation Logic

### Type Selection Rules

| Situation | Type |
|---|---|
| New file, new feature, new script | `feat` |
| Bug fix, null check, error handling | `fix` |
| Documentation, study notes, reference files | `docs` |
| Config, log files, non-functional changes | `chore` |
| Code restructure without behavior change | `refactor` |
| Tests added or updated | `test` |
| Formatting only | `style` |

### Scope Selection Rules

- Use the **most specific folder or topic** that covers the majority of changes
- For multi-area changes, use the **primary** area (e.g., `docs`, `tasks`, `skills`, `scripts`)
- Avoid generic scopes like `learning` or `data` unless nothing more specific applies

### Subject Rules

- Imperative mood: "add", "expand", "migrate", "refactor" — not "added", "expanding"
- ≤50 characters
- No trailing period

### Body Rules

- List the key changes as short lines or bullets
- Each line ≤72 characters
- Explain **what** changed and **why** (motivation or impact)
- Do NOT copy the file stat list verbatim — summarize the meaning

---

## 🧩 Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

---

## 🧾 Output Examples

### Example 1: New script and task files

**Diff summary**: Added `scripts/gen_deep_tasks.py`, added `tasks/ai-learning-autodoc-prompt.md`, expanded 12 `tasks/deep-*.md` files.

**Generated message**:
```
feat(tasks): add gen_deep_tasks script and autodoc cron prompt

Add scripts/gen_deep_tasks.py to auto-generate deep learning task
skeletons from docs/ source files using regex section extraction.

Add tasks/ai-learning-autodoc-prompt.md as a three-phase cron-based
automation prompt for OpenClaw daily AI learning updates.

Expand 12 existing deep-topic task files with richer structured
sections covering additional sub-topics and research questions.
```

### Example 2: Migrating a prompt to a skill

**Diff summary**: Deleted `.github/prompts/git-commit.prompt.md`, created `.github/skills/git-commit/SKILL.md`.

**Generated message**:
```
feat(skills): migrate git-commit from prompt to structured SKILL.md

Replace .github/prompts/git-commit.prompt.md with a fully structured
.github/skills/git-commit/SKILL.md that adds submodule support,
monotonic evidence rules, and non-interactive commit automation.

Add tasks/deep-topic-fine-tuning.md as initial task skeleton for the
fine-tuning deep learning study track.
```

### Example 3: Documentation expansion

**Diff summary**: Expanded `docs/topic-llm-foundations.md` with Transformer deep dive (314 lines added), new `tasks/deep-topic-agent-frameworks.md`.

**Generated message**:
```
docs(llm): expand topic-llm-foundations with Transformer deep dive

Add full Transformer architecture coverage including Self-Attention,
Multi-Head Attention, and Positional Encoding math formulas.

Add complete PyTorch implementation (runnable) and 2025-2026 updates
covering Flash Attention 3.0, SSM fusion, Ring Attention, and MoE.

Add tasks/deep-topic-agent-frameworks.md for CrewAI/AutoGen/LangGraph
comparative research and production selection guide.
```

---

## 🧰 Notes & Constraints

- **Untracked files blocking cherry-pick**: If `git cherry-pick` fails due to untracked files, use `git stash -u` before cherry-pick, then `git stash drop` afterward (do not `stash pop` if the file already exists in the new commit).
- **Already-existing branch**: Always switch away from the target branch before deleting it.
- **Accuracy over speed**: Read the full diff of each commit individually. Do not batch or guess from filenames alone.
- **One commit at a time**: Process each commit fully (analyze → cherry-pick → amend) before moving to the next.
