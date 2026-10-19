// Publish ops — framework-agnostic (ADR-001 phase 2). The fullscreen-fallback
// backfill + publish_project RPC, extracted so the CLI publishes identically.
import type { SupabaseClient } from '@supabase/supabase-js'

const FULLSCREEN_REGION = { x: 0, y: 0, w: 1, h: 1 }

// Pure: a tap_region choice carrying an interaction TEMPLATE but no drawn region
// needs a fullscreen {0,0,1,1} backfill (so runtimes without the interaction engine
// still get a full-screen tap → target). Idempotent — a real region is never touched.
export function needsFullscreenFallback(interaction: unknown, tapRegion: unknown): boolean {
  const hasTemplate = !!(interaction && typeof interaction === 'object' && typeof (interaction as { template?: unknown }).template === 'string')
  const r = tapRegion as { w?: unknown; h?: unknown } | null
  const hasRegion = !!(r && typeof r.w === 'number' && typeof r.h === 'number' && r.w > 0 && r.h > 0)
  return hasTemplate && !hasRegion
}

// Backward-compat safety net (2026-08-16). Backfill a fullscreen tap_region on any
// interaction-template choice missing one, merging so mirrored gesture fields survive.
// Runs before publish_project rebuilds the snapshot. Best-effort: never throws.
export async function ensureFullscreenFallbackRegions(client: SupabaseClient, projectId: string): Promise<void> {
  try {
    const { data: nodes } = await client
      .from('nodes')
      .select('id')
      .eq('project_id', projectId)
      .neq('status', 'removed')
    const nodeIds = (nodes ?? []).map((n: { id: string }) => n.id)
    if (!nodeIds.length) return

    const { data: choices } = await client
      .from('choices')
      .select('id, interaction, tap_region')
      .in('node_id', nodeIds)
      .eq('choice_type', 'tap_region')

    const needing = (choices ?? []).filter((c: { interaction: unknown; tap_region: unknown }) =>
      needsFullscreenFallback(c.interaction, c.tap_region),
    ) as { id: string; tap_region: unknown }[]

    for (const c of needing) {
      const merged = { ...((c.tap_region as object) ?? {}), ...FULLSCREEN_REGION }
      await client.from('choices').update({ tap_region: merged }).eq('id', c.id)
    }
  } catch (err) {
    console.error('[fullscreen-fallback] backfill failed:', err)
  }
}

// Publish: backfill fallback regions, then rebuild the player-facing snapshot via
// publish_project (migration 048 keeps an already-published project published).
// Returns the RPC error (null on success). The editor wraps this with its 048 status
// bookkeeping; the CLI can call it directly.
export async function publishProject(client: SupabaseClient, projectId: string): Promise<{ error: unknown }> {
  await ensureFullscreenFallbackRegions(client, projectId)
  const { error } = await client.rpc('publish_project', { p_project_id: projectId })
  return { error }
}
