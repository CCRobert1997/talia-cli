// Contract tests for the subtree-submission foundation (design_subtree_submission):
// the canonical node-ref enumerator (which also fixes the latent delete-scrub gap),
// the timeout-ref scrubber, and Phase-1 submission validation. Pure — `npm test`.
import { test } from 'vitest'
import assert from 'node:assert/strict'

import { choiceNodeRefs, choiceNodeRefIds, scrubTimeoutTargets } from '../src/invariants/choiceNodeRefs'
import { runSubtreeSubmissionValidation } from '../src/validation/subtree'
import { buildValidationContext } from '../src/validation/runner'
import type { Choice, StoryNode, Project, Variable, Achievement } from '../src/model'

// ── minimal factories (only the fields under test matter) ──────────────────────
const choice = (o: Partial<Choice>): Choice => ({
  id: 'c1', node_id: 'n1', label: '', target_node_id: null, choice_type: 'normal',
  tacoin_cost: null, ai_replace_node_id: null, paid_var_id: null, display_mode: 'button',
  condition_expr: null, effects: null, grants_achievement_id: null, sort_order: 0,
  tap_region: null, interaction: null, created_at: '', ...o,
} as Choice)

const node = (o: Partial<StoryNode>): StoryNode => ({
  id: 'n1', project_id: 'p1', contributor_id: null, title: '', video_url: null,
  duration_s: null, trigger_mode: 'auto', trigger_at_s: null, media_type: 'video',
  thumbnail_url: null, image_urls: [], canvas_x: 0, canvas_y: 0, status: 'active',
  node_type: 'normal', max_branch_count: 8, min_bid_amount: 0, ai_replace_enabled: false,
  ai_replace_segments: null, share_as_short: false, shared_as_short_at: null,
  auto_advance: false, created_at: '', updated_at: '', ...o,
} as StoryNode)

const ctxOf = (nodes: StoryNode[], choices: Choice[], variables: Variable[] = [], achievements: Achievement[] = []) =>
  buildValidationContext({ id: 'p1', start_node_id: nodes[0]?.id ?? null } as Project, nodes, choices, variables, achievements)

// ── enumerator: all five ref sources, incl. the two timeout fields the spec missed ──
test('choiceNodeRefs covers all five node-ref sources', () => {
  const c = choice({
    target_node_id: 'A',
    ai_replace_node_id: 'B',
    interaction: { v: 1, template: 't', outcomes: { hit: { goto: 'C' }, default: { goto: 'D' } } } as unknown as Choice['interaction'],
    tap_region: { x: 0, y: 0, w: 1, h: 1, timeout_target_node_id: 'E' } as unknown as Choice['tap_region'],
  })
  const ids = choiceNodeRefIds(c).sort()
  assert.deepEqual(ids, ['A', 'B', 'C', 'D', 'E'])
})

test('choiceNodeRefs catches interaction.timeout_target_node_id (ChoiceInteraction shape)', () => {
  const c = choice({ interaction: { mode: 'button', timeout_target_node_id: 'Z' } as unknown as Choice['interaction'] })
  assert.deepEqual(choiceNodeRefs(c).map(r => r.source + ':' + r.id), ['interaction.timeout_target_node_id:Z'])
})

test('choiceNodeRefs is empty for a plain normal choice', () => {
  assert.deepEqual(choiceNodeRefs(choice({})), [])
})

// ── scrubber: nulls timeout refs to the deleted node (the previously-missed family) ──
test('scrubTimeoutTargets nulls a matching tap_region timeout ref, leaves others', () => {
  const c = choice({ tap_region: { x: 0, y: 0, w: 1, h: 1, timeout_target_node_id: 'DEAD' } as unknown as Choice['tap_region'] })
  const patch = scrubTimeoutTargets(c, 'DEAD')
  assert.ok(patch && patch.tap_region)
  assert.equal((patch!.tap_region as { timeout_target_node_id: unknown }).timeout_target_node_id, null)
  assert.equal(scrubTimeoutTargets(c, 'SOMETHING_ELSE'), null)
})

// ── Phase-1 submission validation ──────────────────────────────────────────────
test('a clean paid-branch subtree passes', () => {
  const nodes = [node({ id: 'n1' }), node({ id: 'n2', node_type: 'ending' })]
  const choices = [choice({ id: 'c1', node_id: 'n1', choice_type: 'paid', target_node_id: 'n2', tacoin_cost: 20 })]
  assert.deepEqual(runSubtreeSubmissionValidation(ctxOf(nodes, choices)), [])
})

test('variables / achievements / ai_replace / paid_var_id are each rejected', () => {
  const nodes = [node({ id: 'n1', ai_replace_enabled: true })]
  const choices = [choice({ id: 'c1', node_id: 'n1', paid_var_id: 'v1' })]
  const vars = [{ id: 'v1' } as Variable]
  const achs = [{ id: 'a1' } as Achievement]
  const ids = new Set(runSubtreeSubmissionValidation(ctxOf(nodes, choices, vars, achs)).map(i => i.ruleId))
  for (const id of ['subtree_no_variables', 'subtree_no_achievements', 'subtree_no_ai_replace', 'subtree_no_paid_var']) {
    assert.ok(ids.has(id), `expected ${id}`)
  }
})

test('a ref outside the submitted node set is rejected (dangling graft edge)', () => {
  const nodes = [node({ id: 'n1' })]
  const choices = [choice({ id: 'c1', node_id: 'n1', target_node_id: 'GONE' })]
  const issues = runSubtreeSubmissionValidation(ctxOf(nodes, choices))
  assert.ok(issues.some(i => i.ruleId === 'subtree_refs_within_subtree'))
})

test('>30 nodes is rejected', () => {
  const nodes = Array.from({ length: 31 }, (_, i) => node({ id: 'n' + i }))
  const issues = runSubtreeSubmissionValidation(ctxOf(nodes, []))
  assert.ok(issues.some(i => i.ruleId === 'subtree_node_count'))
})
