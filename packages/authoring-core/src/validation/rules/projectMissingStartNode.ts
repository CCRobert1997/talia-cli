import type { ValidationRule, ValidationIssue } from '../types'

// Rule 5 — feed Tap to Play requires an explicit project Start node.
// `projects.start_node_id` is a single-value FK; the rule fires when it's null
// OR when it points at a node that no longer exists / is soft-deleted.
// No nodeId on the issue → groups under "Project-level" in the modal.
export const projectMissingStartNodeRule: ValidationRule = {
  id: 'project_missing_start_node',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const startId = ctx.project.start_node_id
    if (!startId) {
      issues.push({
        ruleId: this.id,
        severity: 'error',
        message: 'validation.project.missingStartNode',
      })
      return issues
    }
    const target = ctx.nodes.find(n => n.id === startId)
    if (!target || target.status === 'removed') {
      issues.push({
        ruleId: this.id,
        severity: 'error',
        message: 'validation.project.startNodeMissing',
      })
    }
    return issues
  },
}
