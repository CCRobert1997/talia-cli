// Node mutation ops — framework-agnostic (ADR-001 phase 2). The write + ordering +
// cascade + invariant-preservation logic, extracted from the editor's useNodes hook
// so the CLI/MCP can perform the same authoring operations. The React-specific parts
// (optimistic setState, toasts, i18n titles) stay in the hook; these ops take an
// injected SupabaseClient and do only data access. crypto.randomUUID / Date work in
// both browser and node.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoryNode } from '../model'

export interface NewNodeInput { projectId: string; x: number; y: number; title: string }

// Pure: mint the client-side id + full node (so the editor can drop it on the canvas
// before the insert round-trips). Title is passed in — core does no i18n.
export function buildNewNode(input: NewNodeInput): { dbFields: Record<string, unknown>; node: StoryNode } {
  const id = crypto.randomUUID()
  const dbFields = {
    id,
    project_id: input.projectId,
    title: input.title,
    status: 'draft',
    node_type: 'normal' as const,
    media_type: 'video' as const,
    trigger_mode: 'end',
    image_urls: [] as string[],
    canvas_x: Math.round(input.x),
    canvas_y: Math.round(input.y),
  }
  const now = new Date().toISOString()
  const node = {
    ...dbFields,
    video_url: null,
    thumbnail_url: null,
    contributor_id: null,
    auto_advance: false,
    ai_replace_enabled: false,
    ai_replace_segments: null,
    share_as_short: false,
    created_at: now,
    updated_at: now,
    meta: { node_id: id, tags: [], achievement_name: null, prerequisite_node_ids: [] },
  } as unknown as StoryNode
  return { dbFields, node }
}

// Insert the node row (awaited — a choice may FK-reference it) + fire node_meta
// (unreferenced → background). Returns the insert error (null on success).
export async function insertNode(client: SupabaseClient, dbFields: Record<string, unknown>): Promise<{ error: unknown }> {
  const { error } = await client.from('nodes').insert(dbFields)
  if (error) return { error }
  void client.from('node_meta').insert({
    node_id: (dbFields as { id: string }).id,
    tags: [],
    achievement_name: null,
    prerequisite_node_ids: [],
  })
  return { error: null }
}

// Update the node row (+ optional node_meta upsert). Throws on error.
export async function updateNodeRow(
  client: SupabaseClient,
  id: string,
  dbUpdates: Record<string, unknown>,
  meta?: StoryNode['meta'],
): Promise<void> {
  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await client
      .from('nodes')
      .update({ ...dbUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }
  if (meta) {
    await client.from('node_meta').upsert({ ...meta, node_id: id })
  }
}

// Delete cascade for a node (soft-delete) — now a thin wrapper over the Postgres
// RPC `delete_node_cascade` (migration 064). The cascade+scrub logic used to live
// here in TS, but the player app (a separate repo that can't import this private
// package) needs the exact same 5-ref scrub, so it was pushed down to the DB as the
// single shared implementation. See migration 064 in root CLAUDE.md for the two
// deliberate divergences from the old TS (both-scrub over goto-first; contributor_id
// guard so this SECURITY DEFINER path can't become a backdoor past the 061 fix).
//
// The RPC computes the surviving-node set itself, so `projectNodeIds` is no longer
// read here — it's kept in the signature so call sites (useNodes) stay untouched.
// Returns nothing; throws on error (the hook maps it to a toast). The RPC's jsonb
// receipt {node_id,project_id,inbound_choices_deleted,outbound_choices_deleted,
// choices_scrubbed} is available on `data` if a caller ever wants counts.
export async function deleteNodeCascade(
  client: SupabaseClient,
  nodeId: string,
  _projectNodeIds: string[],
): Promise<void> {
  const { error } = await client.rpc('delete_node_cascade', { p_node_id: nodeId })
  if (error) throw error
}

export async function updateNodePositionRow(client: SupabaseClient, id: string, x: number, y: number): Promise<void> {
  await client
    .from('nodes')
    .update({ canvas_x: Math.round(x), canvas_y: Math.round(y), updated_at: new Date().toISOString() })
    .eq('id', id)
}

// share_as_short goes through an RPC. Returns the timestamp to reflect locally.
export async function setShareAsShortRpc(client: SupabaseClient, id: string, value: boolean): Promise<{ at: string }> {
  const { error } = await client.rpc('set_share_as_short', { p_node_id: id, p_value: value })
  if (error) throw error
  return { at: new Date().toISOString() }
}
