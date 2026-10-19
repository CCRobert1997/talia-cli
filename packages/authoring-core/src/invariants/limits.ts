// Editor-side limits not enforced at the DB layer.
// Player end has no per-node choice ceiling; this caps the authoring UX.
// Distinct from `nodes.max_branch_count` (community bidding cap, default 8)
// and `MAX_SEGMENTS` in AiReplaceSection (8, ai_replace_segments cap).
export const MAX_CHOICES_PER_NODE = 12
