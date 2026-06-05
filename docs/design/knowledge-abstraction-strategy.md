# Knowledge Abstraction & Architecture Recovery (L3 -> L2)

## Core Pain Points & Objectives

Specific implementation rules (L3) are highly fragmented. We need Non-intrusive Architecture Recovery to deduce L2 modules automatically without disrupting developer flow or blowing out token limits.

## Top-Down Archaeology Strategy

```mermaid
flowchart TD
    subgraph Rich-Semantic Recovery
        R1[Read CHANGELOG.md] --> L2[L2 Candidates]
        R2[Sniff azure-pipelines / Makefile] --> L2
    end

    subgraph VCS-Only Fallback (Degradation)
        F1[git log -n 100 --name-only] --> Hotspots[Hotspot Dirs]
        F2[Depth-2 Topology Scan] --> Hotspots
        F3[L3 Self-Anchoring Paths] --> Hotspots
    end

    L2 --> LLM[LLM Map-Reduce Naming]
    Hotspots --> LLM
    LLM --> Draft[L2 Classification Draft]
    Draft --> UI[User Drags & Approves via TreeView]
```

## 1. Priority Tier: Rich-Semantic Recovery

- Extract `## Headers` from `CHANGELOG.md` or GitHub Releases. These are pure business L2 boundaries created by humans ($O(1)$ cost).
- Extract CI/CD pipelines to define deployment boundaries.

## 2. Degradation Fallback: VCS-Only Snapshot

- If no releases exist, execute a lightweight `git log -n 100` and a Depth-2 directory scan.
- Parse the source paths of unclassified L3 decisions (e.g., `Extracted from src/core/auth.ts`) to perform physical path aggregation.

## 3. High-Density Payload Assembly (Local Map)

- **DO NOT** transmit full Git logs or L3 content.
- Only bundle extracted boundaries and L3 titles. Payload must remain under 1000 Tokens. The LLM names the clusters, and the user approves via UI drag-and-drop.
