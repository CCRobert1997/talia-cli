// Choice mutation ops — framework-agnostic (ADR-001 phase 2). Extracted from
// useChoices; the hook keeps optimistic setState + toasts. The MAX_CHOICES cap is a
// shared authoring invariant (invariants/limits) — the caller enforces it against its
// own count before calling insertChoice.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Choice } from '../model'

export async function insertChoice(client: SupabaseClient, nodeId: string, sortOrder: number): Promise<Choice> {
  const { data, error } = await client
    .from('choices')
    .insert({
      node_id: nodeId,
      label: '',
      target_node_id: null,
      display_mode: 'hide',
      condition_expr: null,
      sort_order: sortOrder,
    })
    .select()
    .single()
  if (error) throw error
  return data as Choice
}

export async function updateChoiceRow(client: SupabaseClient, id: string, updates: Partial<Choice>): Promise<void> {
  const { error } = await client.from('choices').update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteChoiceRow(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('choices').delete().eq('id', id)
  if (error) throw error
}

// Persist a new sort order (index = position). Caller supplies the ordered ids.
export async function reorderChoicesRows(client: SupabaseClient, orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) => client.from('choices').update({ sort_order: index }).eq('id', id)),
  )
}

export async function deleteChoicesForNodeRow(client: SupabaseClient, nodeId: string): Promise<void> {
  const { error } = await client.from('choices').delete().eq('node_id', nodeId)
  if (error) throw error
}
