# Chapter 5: Advanced Features

Explore the advanced configurations and mechanisms in Docuvia.

## 5.1 Human-in-the-Loop Review
The platform uses a continuous iteration loop: AI Generation → Human Review → Correction Feedback. This ensures your knowledge graph remains accurate and reflects domain-specific terminology.

## 5.2 Dynamic Cross-project Links
- The AI detects common nodes across different projects using cosine similarity (threshold ≥ 0.85).
> ⚠️ **Known Limitation**: While cross-links are detected and can be approved in the review queue, the system does not yet automatically generate the `node_links` records in the database.

## 5.3 Custom Prompt Templates
- You can edit L1/L2/L3 system prompts in the **/templates** page.
- Templates support per-project overrides or reverting to global defaults.

## 5.4 Incremental Updates
- The system uses `lastGitIngestedAt` or `lastSvnRevision` cursors.
- You can switch between Full and Incremental updates via the UI to save compute costs.

## 5.5 Cross-team Subscription
- Subscribe to knowledge updates from other projects.
- Notifications are triggered for events like `new_commit`, `new_l3_node`, and `cross_link_detected`.
