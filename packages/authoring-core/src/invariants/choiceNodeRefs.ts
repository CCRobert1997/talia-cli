import type { Choice } from '../model'
import { interactionGotoRefs } from './interactionSchema'

// Canonical enumeration of every node id a choice references. This is the single
// source of truth for anything that must "follow all cross-node edges":
//   - subtree-submission validation ("every ref lands inside the submitted set")
//   - the re-graft remapper's field list (design_subtree_submission §5.4)
//   - deleteNode's dangling-ref scrub
// A choice can point at another node through FIVE places, spread across two
// columns and two jsonb blobs. The `interaction` blob carries BOTH a template's
// `outcomes.*.goto` routes AND a `timeout_target_node_id` — do NOT assume they
// are mutually exclusive "shapes": a single interaction object can hold both at
// once (a template interaction with a timeout window), so anything that scrubs
// node refs must handle goto AND timeout on the same object, not one-or-the-other.
// (Proven by the 064 delete-cascade equivalence probe: the pre-064 TS assumed
// exclusivity and left a dangling `timeout_target_node_id` in exactly that case —
// a narrow latent bug the sunk-to-DB `delete_node_cascade` RPC fixes by scrubbing
// both. See migration 064 in root CLAUDE.md.)
//   1. target_node_id                          (column)
//   2. ai_replace_node_id                       (column)
//   3. interaction.outcomes.{hit,miss,default}.goto  (interaction jsonb)
//   4. interaction.timeout_target_node_id       (interaction jsonb — can co-exist with 3)
//   5. tap_region.timeout_target_node_id        (TapRegion jsonb)
// grants_achievement_id / paid_var_id are NOT node refs (achievement / variable).
export type NodeRefSource =
  | 'target_node_id'
  | 'ai_replace_node_id'
  | 'interaction.outcomes.goto'
  | 'interaction.timeout_target_node_id'
  | 'tap_region.timeout_target_node_id'

export interface NodeRef {
  source: NodeRefSource
  id: string
}

const timeoutTargetOf = (o: unknown): string | null => {
  if (o && typeof o === 'object' && 'timeout_target_node_id' in o) {
    const v = (o as { timeout_target_node_id?: unknown }).timeout_target_node_id
    if (typeof v === 'string' && v) return v
  }
  return null
}

// Every node id `choice` references, tagged with where it came from (duplicates
// possible — e.g. target_node_id also mirrored in outcomes.default).
export function choiceNodeRefs(choice: Pick<Choice, 'target_node_id' | 'ai_replace_node_id' | 'interaction' | 'tap_region'>): NodeRef[] {
  const refs: NodeRef[] = []
  if (choice.target_node_id) refs.push({ source: 'target_node_id', id: choice.target_node_id })
  if (choice.ai_replace_node_id) refs.push({ source: 'ai_replace_node_id', id: choice.ai_replace_node_id })
  for (const id of interactionGotoRefs(choice.interaction)) {
    refs.push({ source: 'interaction.outcomes.goto', id })
  }
  const ixTimeout = timeoutTargetOf(choice.interaction)
  if (ixTimeout) refs.push({ source: 'interaction.timeout_target_node_id', id: ixTimeout })
  const trTimeout = timeoutTargetOf(choice.tap_region)
  if (trTimeout) refs.push({ source: 'tap_region.timeout_target_node_id', id: trTimeout })
  return refs
}

// Distinct node ids a choice references.
export function choiceNodeRefIds(choice: Pick<Choice, 'target_node_id' | 'ai_replace_node_id' | 'interaction' | 'tap_region'>): string[] {
  return [...new Set(choiceNodeRefs(choice).map(r => r.id))]
}

// Scrub the two jsonb TIMEOUT refs (interaction.timeout_target_node_id and
// tap_region.timeout_target_node_id) that point at `deletedId`, nulling them.
// Complements scrubInteractionGotos (which handles outcomes.*.goto) — together
// they cover every jsonb node ref on delete. Column refs (target_node_id) are
// handled by the caller's own delete. Returns only the changed jsonb blobs, or
// null when neither timeout ref pointed at the deleted node.
export function scrubTimeoutTargets(
  choice: Pick<Choice, 'interaction' | 'tap_region'>,
  deletedId: string,
): { interaction?: unknown; tap_region?: unknown } | null {
  const patch: { interaction?: unknown; tap_region?: unknown } = {}
  if (timeoutTargetOf(choice.interaction) === deletedId) {
    patch.interaction = { ...(choice.interaction as object), timeout_target_node_id: null }
  }
  if (timeoutTargetOf(choice.tap_region) === deletedId) {
    patch.tap_region = { ...(choice.tap_region as object), timeout_target_node_id: null }
  }
  return patch.interaction !== undefined || patch.tap_region !== undefined ? patch : null
}
