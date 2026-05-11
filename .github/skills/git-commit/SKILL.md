---
name: git-commit
description: 'Automatically generate and apply Conventional Commits (Angular style) for all staged changes in the current repository.'
---

# Create Commit Messages

Analyze all **staged changes** within the **current repository**, then generate and apply **Conventional Commit** messages (Angular style) automatically.

---

## � Staged Changes Detection

A repository has staged changes if `git --no-pager diff --cached --name-status` produces output. Rely on this simple check to determine if there are changes to be committed.

---

## Enforced Workflow

### Step 1: Analyze Staged Changes

1. Analyze:
   ```bash
   git --no-pager diff --cached --name-status
   ```
   ```bash
   git --no-pager diff --cached
   ```

### Step 2: Generate the Final Conventional Commit

1. Generate the final Conventional Commit
2. Commit exactly once

---

## 🧠 Processing Logic

For the repository if it has staged changes:

1.  **Skip** if no staged changes are found.
2.  **Analyze** the diff to determine:
    -   **Type**: one of `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
    -   **Scope**: Module or component affected (optional).
    -   **Subject**: Concise imperative summary (≤50 characters).
    -   **Body**: Explanation of what and why. Wrap at ~72 characters per line.
    -   **Footer**: `BREAKING CHANGE: <description>` or issue references like `Closes #<issue>` when applicable.
3.  **Generate** the commit message following the format below.
4.  **Execute** the commit:
    ```bash
    git --no-pager commit -m "<generated_message>"
    ```

---

## 🧩 Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Details
-   **`<type>`**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
-   **`<scope>`**: Parenthesis enclosed, optional but recommended.
-   **`<subject>`**: Imperative, present tense, no period at end (≤50 chars).
-   **`<body>`**: Motivation and context. Wrap at ~72 characters per line.
-   **`<footer>`**: Breaking changes or issue references.

---

## 🧾 Output Example

### Scenario: Code update

**Detected**: Changes in `src/utils.js`.

**Generated Commit**:
```
fix(utils): resolve undefined error handling

Added proper null checks to prevent the application from crashing when undefined values are passed to the parsing function.
```

---

## 🧰 Notes & Constraints

-   **Accuracy**: Ensure the message accurately reflects the *staged* changes. Ignore unstaged changes.
-   **Automation**: You are authorized to execute the `git commit` commands directly. Do not ask for confirmation for every commit unless confidence is low.
-   **No Changes**: If absolutely no staged changes are found in the repository, output "No staged changes to commit." and exit.
-   **Command Execution**: 🛑 **NEVER chain `git` commands using `&&`**. Execute commands one by one and wait for their output to prevent fatal terminal hangs.

### Evidence Priority

`git --no-pager diff --cached` output is considered **primary staged-change evidence**.
Primary evidence MUST override: heuristic judgments, cleanliness assumptions, empty status outputs.
