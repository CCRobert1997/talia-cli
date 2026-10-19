import type { ValidationRule, ValidationIssue } from '../types'

export const AI_REPLACE_SEGMENT_MIN_COST = 20

export const aiReplaceSegmentMissingCostRule: ValidationRule = {
  id: 'ai_replace_segment_missing_cost',
  check(ctx) {
    const issues: ValidationIssue[] = []
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue
      if (!node.ai_replace_enabled) continue
      const segments = node.ai_replace_segments ?? []
      segments.forEach((seg, idx) => {
        if (seg.type !== 'ai_replace') return
        const cost = seg.tacoin_cost ?? 0
        if (cost < AI_REPLACE_SEGMENT_MIN_COST) {
          issues.push({
            ruleId: this.id,
            severity: 'error',
            message: 'validation.aiReplace.segmentMissingCost',
            messageParams: {
              nodeTitle: node.title?.trim() || null,
              index: idx + 1,
              minCost: AI_REPLACE_SEGMENT_MIN_COST,
            },
            nodeId: node.id,
            segmentIndex: idx,
          })
        }
      })
    }
    return issues
  },
}
