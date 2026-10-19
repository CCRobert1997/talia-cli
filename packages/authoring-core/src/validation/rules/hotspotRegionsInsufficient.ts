import type { ValidationRule, ValidationIssue } from '../types'

// Rule — hotspot_collect must have enough placed regions (ticket 2026-08-21).
// The player reads `interaction.params.regions[]` for the tappable hotspots;
// with 0 regions the runtime resolves straight to `default` → the node flashes
// past and nothing is clickable. `need = clamp(needK, 1, regions.length)`, so a
// hotspot with fewer regions than needK also silently lowers the requirement.
// Block publish on both: 0 regions is an error, regions < needK is a warning.
// Community choices exempt (pre-generated, standard pattern).
//
// choice.interaction is typed as the legacy ChoiceInteraction shape, but advanced
// templates store the {template, params} jsonb — read it loosely.
export const hotspotRegionsInsufficientRule: ValidationRule = {
  id: 'hotspot_regions_insufficient',
  check(ctx) {
    const issues: ValidationIssue[] = []
    const nodeById = new Map(ctx.nodes.map(n => [n.id, n]))
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue
      const itx = choice.interaction as unknown as
        | { template?: string; params?: { regions?: unknown; needK?: unknown } }
        | null
        | undefined
      if (!itx || itx.template !== 'hotspot_collect') continue

      const regions = Array.isArray(itx.params?.regions) ? itx.params!.regions : []
      const needK = typeof itx.params?.needK === 'number' ? itx.params!.needK : 1
      const parent = nodeById.get(choice.node_id)
      const base = {
        nodeId: choice.node_id,
        choiceId: choice.id,
        messageParams: {
          choiceLabel: choice.label?.trim() || null,
          parentNodeTitle: parent?.title?.trim() || null,
          needK,
          regionCount: regions.length,
        },
      }

      if (regions.length === 0) {
        // Unplayable — flashes past. Hard error.
        issues.push({ ...base, ruleId: this.id, severity: 'error', message: 'validation.hotspot.noRegions' })
      } else if (regions.length < needK) {
        // Playable but the requirement is silently clamped down. Warn.
        issues.push({ ...base, ruleId: this.id, severity: 'warning', message: 'validation.hotspot.fewerThanNeedK' })
      }
    }
    return issues
  },
}
