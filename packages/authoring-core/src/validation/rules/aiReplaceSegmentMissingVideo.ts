import type { ValidationRule, ValidationIssue } from '../types'

export const aiReplaceSegmentMissingVideoRule: ValidationRule = {
  id: 'ai_replace_segment_missing_video',
  check(ctx) {
    const issues: ValidationIssue[] = []
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue
      if (!node.ai_replace_enabled) continue
      const segments = node.ai_replace_segments ?? []
      segments.forEach((seg, idx) => {
        if (seg.type === 'ai_replace' && !seg.video_url) {
          issues.push({
            ruleId: this.id,
            severity: 'error',
            message: 'validation.aiReplace.segmentMissingVideo',
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
