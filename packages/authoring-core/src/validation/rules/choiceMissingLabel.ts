import type { ValidationRule, ValidationIssue } from '../types'

// Rule — every choice must have a non-blank label.
// Empty labels render as "dead" or anonymous buttons on the player end (see
// 2026-05-17 empty-choice-button-rendered bug report + 2026-05-20 real-game
// observation). Community-imported choices are exempt: accepted submissions
// may carry sparse fields and we don't want to retroactively block creators
// from publishing because of someone else's submission.
export const choiceMissingLabelRule: ValidationRule = {
  id: 'choice_missing_label',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const nodeById = new Map(ctx.nodes.map(n => [n.id, n]))

    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      const label = choice.label?.trim() ?? ''
      if (label.length > 0) continue

      const parent = nodeById.get(choice.node_id)
      issues.push({
        ruleId: this.id,
        severity: 'error',
        message: 'validation.choice.missingLabel',
        messageParams: {
          parentNodeTitle: parent?.title?.trim() || null,
        },
        nodeId: choice.node_id,
        choiceId: choice.id,
      })
    }
    return issues
  },
}
