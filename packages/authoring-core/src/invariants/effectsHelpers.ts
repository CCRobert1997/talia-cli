import type { ChoiceEffect } from '../model'

export function setOrReplaceBoolEffect(
  effects: ChoiceEffect[] | null,
  varId: string,
  value: boolean,
): ChoiceEffect[] {
  const filtered = (effects ?? []).filter(e => e.var_id !== varId)
  return [...filtered, { var_id: varId, op: 'set', value }]
}

export function removeEffectsForVar(
  effects: ChoiceEffect[] | null,
  varId: string,
): ChoiceEffect[] | null {
  if (!effects) return null
  const remaining = effects.filter(e => e.var_id !== varId)
  return remaining.length > 0 ? remaining : null
}

/**
 * Tolerant match for legacy data: accepts boolean, number (0/!=0), or string
 * ("true"/"false"). New writes must use pure boolean; this only exists so
 * publish validation doesn't falsely flag historical dirty rows.
 */
export function effectMatchesBool(
  effect: ChoiceEffect,
  varId: string,
  expected: boolean,
): boolean {
  if (effect.var_id !== varId) return false
  if (effect.op !== 'set') return false
  const v: unknown = effect.value
  if (typeof v === 'boolean') return v === expected
  if (typeof v === 'number') return v !== 0 === expected
  if (typeof v === 'string') return v.toLowerCase() === String(expected)
  return false
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40)
}

export function defaultPaidVarName(targetTitle: string, existingNames: string[]): string {
  let slug = slugifyTitle(targetTitle || '')
  if (!slug) slug = Math.random().toString(36).slice(2, 8)
  const base = `ai_replace_paid_${slug}`
  if (!existingNames.includes(base)) return base
  const hash = Math.random().toString(36).slice(2, 8)
  return `${base}_${hash}`
}
