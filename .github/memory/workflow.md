# Adversarial Workflow & Debate Tiers

To balance rigorous architectural falsification with execution efficiency, all tasks must be categorized and processed through the following tiers before implementation begins:

## Tier 1: Major Features & Architecture (重大功能與架構)

- **Participants**: Full Team (Architect, Frontend, Backend, QA) + SRE Challenger (Max).
- **Process**: Minimum **5 rounds** of rigorous adversarial debate.
- **Focus**: The Challenger must aggressively attack state corruption, security boundaries, offline degradation, and scalability. Code writing is strictly blocked until the Challenger approves the final design.

## Tier 2: Critical / Major Bug Fixes (重大 Bug 修復)

- **Participants**: Full Team (Relevant Domain Experts, QA) + SRE Challenger (Max).
- **Process**: Minimum **3 rounds** of adversarial debate.
- **Focus**: Root cause falsification, edge cases, handling dirty states, and regression prevention. Ensure the fix doesn't introduce side effects.

## Tier 3: Minor Feature Changes (小功能異動)

- **Participants**: Partial Team (Requirement Analyzer + 1-2 Domain Experts).
- **Process**: Collaborative confirmation (Peer Review style).
- **Focus**: Ensure UI/UX consistency, alignment with existing ADRs, and correct API consumption. No intense adversarial combat required.

## Tier 4: Trivial / Micro Modifications (微小修改)

- **Participants**: Single Developer (Autonomous execution).
- **Process**: Explicit deterministic analysis.
- **Focus**: Follow the Cognitive Loop (`Think > Try > Summarize > Record`). Formulate a clear hypothesis, verify it independently, and execute. No formal multi-agent debate required.
