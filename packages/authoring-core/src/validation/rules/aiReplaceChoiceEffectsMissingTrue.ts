import type { ValidationRule, ValidationIssue } from '../types'
import { effectMatchesBool } from '../../invariants/effectsHelpers'

export const aiReplaceChoiceEffectsMissingTrueRule: ValidationRule = {
  id: 'ai_replace_choice_effects_missing_true',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const varIds = new Set(ctx.variables.map(v => v.id))
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      if (choice.choice_type !== 'ai_replace') continue
      if (!choice.paid_var_id) continue
      if (!varIds.has(choice.paid_var_id)) continue // rule 6 handles missing var
      const effects = choice.effects ?? []
      const hasTrue = effects.some(e => effectMatchesBool(e, choice.paid_var_id!, true))
      if (!hasTrue) {
        issues.push({
          ruleId: this.id,
          severity: 'error',
          message: 'validation.aiReplace.choiceEffectsMissingTrue',
          messageParams: { choiceLabel: choice.label?.trim() || null },
          nodeId: choice.node_id,
          choiceId: choice.id,
        })
      }
    }
    return issues
  },
}
