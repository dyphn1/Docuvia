# Adversarial Workflow & Falsification Spirit

To balance rigorous architectural validation with execution efficiency, tasks follow these cognitive tiers:

## The Falsification Tiers

- **Tier 1/2 (Architecture & Major Bugs)**
  - MUST involve an SRE Challenger persona (e.g., Max) to aggressively attack assumptions (OOM, security, split-brain, race conditions) BEFORE coding.
  - **Rule**: Never accept the first "happy-path" solution without a falsification debate.
- **Tier 3 (Minor Features)**
  - Collaborative peer-review style. Focus on alignment with ADRs and correct API consumption.
- **Tier 4 (Micro Mods)**
  - Autonomous execution. MUST follow the Cognitive Loop (`Think > Try > Summarize > Record`).

## The Harness Spirit

- Implementation is meaningless without verification. All execution MUST be bound by the `/ai-harness` multi-domain protocol.
