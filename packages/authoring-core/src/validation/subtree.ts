import type { ValidationContext, ValidationIssue, ValidationRule } from './types'
import { choiceNodeRefs } from '../invariants/choiceNodeRefs'

// Phase-1 subtree-submission validation (design_subtree_submission §4). This runs
// on the CONTRIBUTOR's own project at submit time — the main defence — and MUST be
// mirrored inside the graft RPC (client validation is not a security boundary;
// 048 auto-republish taught us to re-check server-side).
//
// Allowed: any graph shape (branch/merge/cycle), all interaction templates,
// tap_region, presentation, auto_advance, and PAID choices (the whole point).
// Forbidden in Phase 1: variables, achievements, ai_replace, paid_var_id (binds a
// variable), refs pointing outside the submitted node set, and >30 nodes. The
// expensive part deferred to Phase 2 is the variable/achievement NAMESPACE merge
// (condition_expr is a string that would need cross-project rewriting), not graph
// shape — the remapper treats 1 edge and N edges identically.
//
// Kept OUT of ALL_RULES (the publish path) — a main project legitimately has
// variables/achievements. Run explicitly via runSubtreeSubmissionValidation.

const MAX_NODES = 30

const liveNodes = (ctx: ValidationContext) => ctx.nodes.filter(n => n.status !== 'removed')

const subtreeNoVariablesRule: ValidationRule = {
  id: 'subtree_no_variables',
  check(ctx) {
    if (ctx.variables.length === 0) return []
    return [{ ruleId: this.id, severity: 'error', message: 'validation.subtree.noVariables' }]
  },
}

const subtreeNoAchievementsRule: ValidationRule = {
  id: 'subtree_no_achievements',
  check(ctx) {
    if (ctx.achievements.length === 0) return []
    return [{ ruleId: this.id, severity: 'error', message: 'validation.subtree.noAchievements' }]
  },
}

const subtreeNoAiReplaceRule: ValidationRule = {
  id: 'subtree_no_ai_replace',
  check(ctx) {
    const issues: ValidationIssue[] = []
    for (const n of liveNodes(ctx)) {
      if (n.ai_replace_enabled) {
        issues.push({ ruleId: this.id, severity: 'error', message: 'validation.subtree.noAiReplace', nodeId: n.id })
      }
    }
    for (const c of ctx.choices) {
      if (c.choice_type === 'ai_replace') {
        issues.push({ ruleId: this.id, severity: 'error', message: 'validation.subtree.noAiReplace', nodeId: c.node_id, choiceId: c.id })
      }
    }
    return issues
  },
}

const subtreeNoPaidVarRule: ValidationRule = {
  id: 'subtree_no_paid_var',
  check(ctx) {
    const issues: ValidationIssue[] = []
    for (const c of ctx.choices) {
      if (c.paid_var_id) {
        issues.push({ ruleId: this.id, severity: 'error', message: 'validation.subtree.noPaidVar', nodeId: c.node_id, choiceId: c.id })
      }
    }
    return issues
  },
}

const subtreeNodeCountRule: ValidationRule = {
  id: 'subtree_node_count',
  check(ctx) {
    const count = liveNodes(ctx).length
    if (count <= MAX_NODES) return []
    return [{ ruleId: this.id, severity: 'error', message: 'validation.subtree.tooManyNodes', messageParams: { count, max: MAX_NODES } }]
  },
}

// Every cross-node ref (via choiceNodeRefs — all 5 sources) must land on a live
// node inside this project. A ref outside the set can't be grafted (the remapper
// only knows the submitted subtree) — it would ship a dangling edge.
const subtreeRefsWithinRule: ValidationRule = {
  id: 'subtree_refs_within_subtree',
  check(ctx) {
    const live = new Set(liveNodes(ctx).map(n => n.id))
    const issues: ValidationIssue[] = []
    for (const c of ctx.choices) {
      for (const ref of choiceNodeRefs(c)) {
        if (!live.has(ref.id)) {
          issues.push({
            ruleId: this.id,
            severity: 'error',
            message: 'validation.subtree.refOutsideSubtree',
            messageParams: { source: ref.source },
            nodeId: c.node_id,
            choiceId: c.id,
          })
        }
      }
    }
    return issues
  },
}

export const SUBTREE_SUBMISSION_RULES: ValidationRule[] = [
  subtreeNoVariablesRule,
  subtreeNoAchievementsRule,
  subtreeNoAiReplaceRule,
  subtreeNoPaidVarRule,
  subtreeNodeCountRule,
  subtreeRefsWithinRule,
]

export function runSubtreeSubmissionValidation(ctx: ValidationContext): ValidationIssue[] {
  return SUBTREE_SUBMISSION_RULES.flatMap(r => r.check(ctx))
}
