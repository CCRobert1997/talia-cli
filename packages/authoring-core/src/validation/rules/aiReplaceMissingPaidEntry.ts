import type { ValidationRule, ValidationIssue } from '../types'

export const aiReplaceMissingPaidEntryRule: ValidationRule = {
  id: 'ai_replace_missing_paid_entry',
  check(ctx) {
    const issues: ValidationIssue[] = []
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue
      if (!node.ai_replace_enabled) continue
      const hasPaidEntry = ctx.choices.some(
        c => c.choice_type === 'ai_replace' && c.ai_replace_node_id === node.id,
      )
      if (!hasPaidEntry) {
        issues.push({
          ruleId: this.id,
          severity: 'error',
          message: 'validation.aiReplace.missingPaidEntry',
          messageParams: { nodeTitle: node.title?.trim() || null },
          nodeId: node.id,
        })
      }
    }
    return issues
  },
}
