// Variable mutation ops — framework-agnostic (ADR-001 phase 2).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Variable, VarType } from '../model'

export interface NewVariableInput {
  projectId: string
  name: string
  varType: VarType
  defaultValue?: boolean | number
  minValue?: number | null
  maxValue?: number | null
}

export async function insertVariable(client: SupabaseClient, input: NewVariableInput): Promise<Variable> {
  const { data, error } = await client
    .from('variables')
    .insert({
      project_id: input.projectId,
      name: input.name,
      var_type: input.varType,
      default_value: input.defaultValue !== undefined ? input.defaultValue : (input.varType === 'bool' ? false : 0),
      min_value: input.minValue ?? null,
      max_value: input.maxValue ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Variable
}

export async function updateVariableRow(client: SupabaseClient, id: string, updates: Partial<Variable>): Promise<void> {
  const { error } = await client.from('variables').update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteVariableRow(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('variables').delete().eq('id', id)
  if (error) throw error
}
