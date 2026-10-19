// Achievement mutation ops — framework-agnostic (ADR-001 phase 2).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Achievement, ConditionExpr } from '../model'

export interface NewAchievementInput {
  projectId: string
  name: string
  emoji: string
  description: string | null
  conditionExpr: ConditionExpr
}

export async function insertAchievement(client: SupabaseClient, input: NewAchievementInput): Promise<Achievement> {
  const { data, error } = await client
    .from('achievements')
    .insert({
      project_id: input.projectId,
      name: input.name,
      emoji: input.emoji,
      description: input.description,
      condition_expr: input.conditionExpr,
    })
    .select()
    .single()
  if (error) throw error
  return data as Achievement
}

export async function updateAchievementRow(client: SupabaseClient, id: string, updates: Partial<Achievement>): Promise<void> {
  const { error } = await client.from('achievements').update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteAchievementRow(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('achievements').delete().eq('id', id)
  if (error) throw error
}
