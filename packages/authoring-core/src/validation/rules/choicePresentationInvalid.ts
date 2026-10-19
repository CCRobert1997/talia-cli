import type { ValidationRule, ValidationIssue } from '../types'
import { parsePresentation, isImageSkin } from '../../invariants/choicePresentation'

// Rule — choice presentation sanity (design_choice_presentation_spectrum §1/§5.3).
// pos/w bounds, skin whitelist, size/font are all clamped write-time by
// normalizePresentation (invalid → default), so the only thing left that can ship
// a broken screen is an IMAGE skin with no text fallback: if the image 404s the
// player renders the label, and an empty label = an invisible/unlabelled button.
// Community choices exempt (standard pattern).
export const choicePresentationInvalidRule: ValidationRule = {
  id: 'choice_presentation_invalid',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const nodeById = new Map(ctx.nodes.map(n => [n.id, n]))
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      const pres = parsePresentation(choice.interaction)
      if (!pres) continue
      if (isImageSkin(pres.skin) && !choice.label?.trim()) {
        const parent = nodeById.get(choice.node_id)
        issues.push({
          ruleId: this.id,
          severity: 'error',
          message: 'validation.presentation.imageNeedsText',
          messageParams: { parentNodeTitle: parent?.title?.trim() || null },
          nodeId: choice.node_id,
          choiceId: choice.id,
        })
      }
    }
    return issues
  },
}
