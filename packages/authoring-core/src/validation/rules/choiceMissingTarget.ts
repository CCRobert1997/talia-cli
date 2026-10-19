import type { ValidationRule, ValidationIssue } from '../types'

// Rule — `normal` and `paid` choices must point at a target node.
// - `ai_replace` choices route via `ai_replace_node_id`, not `target_node_id`
// - `tap_region` choices' navigation is handled per-region (no global target)
// so we only fire on normal / paid where `target_node_id` is null.
// Community-imported choices are exempt (see choiceMissingLabel rule).
const TARGET_REQUIRED_TYPES = new Set<string>(['normal', 'paid'])

export const choiceMissingTargetRule: ValidationRule = {
  id: 'choice_missing_target',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const nodeById = new Map(ctx.nodes.map(n => [n.id, n]))

    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      const type = choice.choice_type ?? 'normal'
      if (!TARGET_REQUIRED_TYPES.has(type)) continue
      if (choice.target_node_id) continue

      const parent = nodeById.get(choice.node_id)
      issues.push({
        ruleId: this.id,
        severity: 'error',
        message: 'validation.choice.missingTarget',
        messageParams: {
          choiceLabel: choice.label?.trim() || null,
          parentNodeTitle: parent?.title?.trim() || null,
        },
        nodeId: choice.node_id,
        choiceId: choice.id,
      })
    }
    return issues
  },
}
