import type { ValidationRule, ValidationIssue } from '../types'
import type { ConditionExpr } from '../../model'

function extractVarIds(expr: ConditionExpr): string[] {
  if (!expr) return []
  if (expr.type === 'bool' || expr.type === 'int') return [expr.var_id]
  return expr.conditions.map(c => c.var_id)
}

export const aiReplaceTargetReachedByNonAiChoiceRule: ValidationRule = {
  id: 'ai_replace_target_reached_by_non_ai_choice',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const nodeById = new Map(ctx.nodes.map(n => [n.id, n]))

    const paidVarsByTarget = new Map<string, Set<string>>()
    for (const c of ctx.choices) {
      if (c.choice_type !== 'ai_replace') continue
      if (!c.ai_replace_node_id || !c.paid_var_id) continue
      let set = paidVarsByTarget.get(c.ai_replace_node_id)
      if (!set) {
        set = new Set<string>()
        paidVarsByTarget.set(c.ai_replace_node_id, set)
      }
      set.add(c.paid_var_id)
    }

    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      if (!choice.target_node_id) continue
      if (choice.choice_type === 'ai_replace') continue
      if (ctx.isCommunityNode(choice.target_node_id)) continue
      const target = nodeById.get(choice.target_node_id)
      if (!target || !target.ai_replace_enabled) continue

      if (choice.condition_expr) {
        const targetPaidVars = paidVarsByTarget.get(target.id)
        if (targetPaidVars && targetPaidVars.size > 0) {
          const varIds = extractVarIds(choice.condition_expr)
          if (varIds.some(v => targetPaidVars.has(v))) continue
        }
      }

      const parent = nodeById.get(choice.node_id)
      issues.push({
        ruleId: this.id,
        severity: 'error',
        message: 'validation.aiReplace.targetReachedByNonAiChoice',
        messageParams: {
          choiceLabel: choice.label?.trim() || null,
          targetNodeTitle: target.title?.trim() || null,
          parentNodeTitle: parent?.title?.trim() || null,
        },
        nodeId: choice.node_id,
        choiceId: choice.id,
      })
    }
    return issues
  },
}
