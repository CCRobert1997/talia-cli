// Project mutation ops — framework-agnostic (ADR-001 phase 2). Carries two authoring
// invariants beyond plain CRUD: the ordered delete cascade (migration 047 dependency
// order) and the "editing a rejected project flips it back to draft" moderation rule.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Project, ProjectStatus } from '../model'

export async function insertProject(client: SupabaseClient, ownerId: string, title: string): Promise<Project> {
  const { data, error } = await client
    .from('projects')
    .insert({ owner_id: ownerId, title, status: 'draft' })
    .select()
    .single()
  if (error) throw error
  return data as Project
}

// Update a project row (stamps updated_at). Caller applies withRejectedToDraftFlip
// first when appropriate (see below).
export async function updateProjectRow(client: SupabaseClient, id: string, patch: Partial<Project>): Promise<void> {
  const { error } = await client
    .from('projects')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Pure moderation invariant (A4, 2026-06-13, no DB trigger): editing ANY field of a
// rejected project flips it back to draft so the creator can revise + resubmit — but
// only when the caller isn't already setting status (don't fight an explicit publish).
export function withRejectedToDraftFlip(currentStatus: ProjectStatus | undefined, updates: Partial<Project>): Partial<Project> {
  const patch: Partial<Project> = { ...updates }
  if (currentStatus === 'rejected' && patch.status === undefined) {
    patch.status = 'draft'
    patch.last_rejection_reason_category = null
    patch.last_rejection_reason_text = null
  }
  return patch
}

// Ordered delete cascade (migration 047). Player-side social tables + choice_purchases
// are cascaded by DB FKs (they belong to other accounts under RLS anyway). Throws the
// real error (a 23503 means a child table still references the project).
export async function deleteProjectCascade(client: SupabaseClient, id: string): Promise<void> {
  const { data: nodeRows, error: nodeSelErr } = await client.from('nodes').select('id').eq('project_id', id)
  if (nodeSelErr) throw nodeSelErr
  const nodeIds = (nodeRows ?? []).map((n: { id: string }) => n.id)

  if (nodeIds.length > 0) {
    const { error: chErr } = await client.from('choices').delete().in('node_id', nodeIds)
    if (chErr) throw chErr
    const { error: nmErr } = await client.from('node_meta').delete().in('node_id', nodeIds)
    if (nmErr) throw nmErr
  }
  const { error: nErr } = await client.from('nodes').delete().eq('project_id', id)
  if (nErr) throw nErr
  const { error: vErr } = await client.from('variables').delete().eq('project_id', id)
  if (vErr) throw vErr
  const { error: csErr } = await client.from('collab_submissions').delete().eq('project_id', id)
  if (csErr) throw csErr

  const { error } = await client.from('projects').delete().eq('id', id)
  if (error) throw error
}
