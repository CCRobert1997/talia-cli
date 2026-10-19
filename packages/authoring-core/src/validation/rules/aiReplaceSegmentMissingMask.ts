import type { ValidationRule, ValidationIssue } from '../types'

export const aiReplaceSegmentMissingMaskRule: ValidationRule = {
  id: 'ai_replace_segment_missing_mask',
  check(ctx) {
    const issues: ValidationIssue[] = []
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue
      if (!node.ai_replace_enabled) continue
      const segments = node.ai_replace_segments ?? []
      segments.forEach((seg, idx) => {
        if (seg.type !== 'ai_replace') return
        const positiveCount = seg.mask?.positive?.length ?? 0
        if (positiveCount < 1) {
          issues.push({
            ruleId: this.id,
            severity: 'error',
            message: 'validation.aiReplace.segmentMissingMask',
            messageParams: {
              nodeTitle: node.title?.trim() || null,
              index: idx + 1,
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
