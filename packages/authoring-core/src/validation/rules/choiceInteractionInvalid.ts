import type { ValidationRule, ValidationIssue } from '../types'

// Rule — interaction config sanity (migration 041 choices.interaction).
// A timed window whose end isn't after its start can never fire → the choice
// is unreachable mid-video. Community choices exempt (standard pattern).
export const choiceInteractionInvalidRule: ValidationRule = {
  id: 'choice_interaction_invalid',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const nodeById = new Map(ctx.nodes.map(n => [n.id, n]))
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      // Timed windows can live on legacy choices.interaction OR (since
      // 2026-07-24 gesture unification) inside tap_region itself.
      const win = choice.interaction?.window ?? choice.tap_region?.window
      if (!win || win.type !== 'timed') continue
      const { start_s, end_s } = win
      if (!(Number.isFinite(start_s) && Number.isFinite(end_s)) || end_s <= start_s) {
        const parent = nodeById.get(choice.node_id)
        issues.push({
          ruleId: this.id,
          severity: 'error',
          message: 'validation.choice.interactionWindowInvalid',
          messageParams: {
            choiceLabel: choice.label?.trim() || null,
            parentNodeTitle: parent?.title?.trim() || null,
          },
          nodeId: choice.node_id,
          choiceId: choice.id,
        })
      }
    }
    return issues
  },
}
