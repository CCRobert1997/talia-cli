import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoryNode, Choice, ConditionExpr } from '../model'

export interface FallbackScaffoldArgs {
  projectId: string
  aiReplaceChoice: Choice
  xNode: StoryNode
  paidVarId: string
  nodeTitle: string
  choiceLabel: string
}

export type FallbackScaffoldResult =
  | {
      kind: 'ok'
      fallbackNode: StoryNode
      fallbackChoice: Choice
      cxChoiceId: string | null
      cxChoicePatch: Partial<Choice> | null
    }
  | { kind: 'parent_lookup_failed'; count: number }

export async function createFallbackScaffold(
  client: SupabaseClient,
  args: FallbackScaffoldArgs,
): Promise<FallbackScaffoldResult> {
  const { aiReplaceChoice: A, xNode: X } = args
  const paidVarFalse: ConditionExpr = {
    type: 'bool',
    var_id: args.paidVarId,
    op: 'eq',
    value: false,
  }
  const paidVarTrue: ConditionExpr = {
    type: 'bool',
    var_id: args.paidVarId,
    op: 'eq',
    value: true,
  }

  const isSimple = !!A.target_node_id && A.target_node_id === A.ai_replace_node_id

  let mNodeId: string
  let cxChoice: Choice | null = null

  if (isSimple) {
    mNodeId = A.node_id
  } else {
    const { data: parents, error: parentsErr } = await client
      .from('choices')
      .select('*')
      .eq('target_node_id', X.id)
    if (parentsErr) throw parentsErr
    const uniqueMs = new Set((parents ?? []).map(c => c.node_id as string))
    if (uniqueMs.size !== 1) {
      return { kind: 'parent_lookup_failed', count: uniqueMs.size }
    }
    mNodeId = uniqueMs.values().next().value as string
    cxChoice = ((parents ?? []).find(c => c.node_id === mNodeId) ?? null) as Choice | null
  }

  const { count: siblingsCount } = await client
    .from('choices')
    .select('id', { count: 'exact', head: true })
    .eq('node_id', mNodeId)
  const sortOrder = siblingsCount ?? 0

  const { data: nodeData, error: nodeError } = await client
    .from('nodes')
    .insert({
      project_id: args.projectId,
      title: args.nodeTitle,
      status: 'draft',
      node_type: 'normal',
      media_type: 'video',
      trigger_mode: 'end',
      image_urls: [],
      canvas_x: Math.round(X.canvas_x + 480),
      canvas_y: Math.round(X.canvas_y),
    })
    .select()
    .single()
  if (nodeError || !nodeData) {
    throw nodeError ?? new Error('Failed to create fallback node')
  }
  const createdNodeId = nodeData.id as string

  try {
    await client.from('node_meta').insert({
      node_id: createdNodeId,
      tags: [],
      achievement_name: null,
      prerequisite_node_ids: [],
    })
  } catch {
    // Non-fatal: meta row creation; defaults applied server-side if missing.
  }

  try {
    const { data: choiceData, error: choiceError } = await client
      .from('choices')
      .insert({
        node_id: mNodeId,
        label: args.choiceLabel,
        target_node_id: createdNodeId,
        choice_type: 'normal',
        display_mode: 'hide',
        condition_expr: isSimple ? null : paidVarFalse,
        sort_order: sortOrder,
      })
      .select()
      .single()
    if (choiceError || !choiceData) {
      throw choiceError ?? new Error('Failed to create fallback choice')
    }

    let cxChoiceId: string | null = null
    let cxChoicePatch: Partial<Choice> | null = null
    if (!isSimple && cxChoice && !cxChoice.condition_expr) {
      const { error: updErr } = await client
        .from('choices')
        .update({ condition_expr: paidVarTrue })
        .eq('id', cxChoice.id)
      if (updErr) throw updErr
      cxChoiceId = cxChoice.id
      cxChoicePatch = { condition_expr: paidVarTrue }
    }

    const fallbackNode: StoryNode = {
      ...(nodeData as StoryNode),
      meta: {
        node_id: createdNodeId,
        tags: [],
        achievement_name: null,
        prerequisite_node_ids: [],
      },
    }
    return {
      kind: 'ok',
      fallbackNode,
      fallbackChoice: choiceData as Choice,
      cxChoiceId,
      cxChoicePatch,
    }
  } catch (err) {
    try {
      await client.from('choices').delete().eq('node_id', createdNodeId)
      await client.from('nodes').update({ status: 'removed' }).eq('id', createdNodeId)
    } catch {
      // Rollback best-effort; surface the original error to caller.
    }
    throw err
  }
}
