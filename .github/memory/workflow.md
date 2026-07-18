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

## Decision Routing: Contract Decisions vs. Implementer Judgment Calls

Two distinct weights of "who decides," established during the Phase 1 background-knowledge-evolution rollout (Docuvia2):

- **Open architectural/contract decisions** — things that shape a slice's design before implementation starts (e.g. open items carried forward from a prior slice, plus new AI-proposed recommendations) — are NOT ruled ad hoc by the orchestrator. Per explicit owner instruction, route them to a Fable-model architecture consult, then record the outcome as a new lettered section in the relevant decision doc (e.g. `docs/gitbook/analysis/phase1-decision-integration.md` §9a-9l for Tier C). This is the established path for future slices' open sub-decisions too.
- **Implementer judgment calls** that surface _after_ a contract already exists (small gaps the contract didn't close, or genuine ambiguity in an otherwise-spec'd contract) are ruled directly by the orchestrator, not re-routed to a consult. Record these as a lightweight `§Nl`-style addendum to the same decision doc (precedent: §6d, §8, §9l). If an implementer's addition merely duplicates something the contract already satisfies (e.g. a redundant field mirroring a pre-existing one), the orchestrator reverts it directly rather than treating it as a new decision.
