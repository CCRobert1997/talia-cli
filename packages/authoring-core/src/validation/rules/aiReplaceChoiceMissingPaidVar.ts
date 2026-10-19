import type { ValidationRule, ValidationIssue } from '../types'

export const aiReplaceChoiceMissingPaidVarRule: ValidationRule = {
  id: 'ai_replace_choice_missing_paid_var',
  check(ctx) {
    const issues: ValidationIssue[] = []
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      if (choice.choice_type !== 'ai_replace') continue
      if (choice.paid_var_id) continue
      issues.push({
        ruleId: this.id,
        severity: 'error',
        message: 'validation.aiReplace.choiceMissingPaidVar',
        messageParams: { choiceLabel: choice.label?.trim() || null },
        nodeId: choice.node_id,
        choiceId: choice.id,
      })
    }
    return issues
  },
}
