import type { ValidationRule, ValidationIssue } from '../types'

export const aiReplacePaidVarNotFoundRule: ValidationRule = {
  id: 'ai_replace_paid_var_not_found',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const varIds = new Set(ctx.variables.map(v => v.id))
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      if (choice.choice_type !== 'ai_replace') continue
      if (!choice.paid_var_id) continue
      if (varIds.has(choice.paid_var_id)) continue
      issues.push({
        ruleId: this.id,
        severity: 'error',
        message: 'validation.aiReplace.paidVarNotFound',
        messageParams: { choiceLabel: choice.label?.trim() || null },
        nodeId: choice.node_id,
        choiceId: choice.id,
      })
    }
    return issues
  },
}
