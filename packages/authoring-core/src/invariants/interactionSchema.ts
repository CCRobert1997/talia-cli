// Serialization + contract layer for interaction templates (design
// task_prompts/design_anchor_track_templates_v1.md §2 + §2.1 invariants).
//
// Boundary design: parse() reads the RAW `choices.interaction` jsonb (typed
// `unknown` — real-world data may be the new template schema, the legacy 041
// ChoiceInteraction, or absent) plus `choices.tap_region`, and returns a clean
// editor UI model. serialize() turns the UI model back into { interaction,
// tapRegionPatch, targetNodeId } to write. Keeping this at the jsonb boundary
// avoids widening the Choice.interaction TS union across every legacy reader.
//
// Contract highlights (§2.1, must not break):
//  1. target_node_id ≡ outcomes.default.goto  (old app w/o runtime routes by
//     target_node_id; new app degradation routes by outcomes.default — they
//     must converge). serialize() enforces this.
//  2. Write-time validation is the MAIN guard (048 auto-republish bypasses the
//     publish validator). validate() checks goto-exists + param ranges.
//  3. Region rectangle lives in choice.tap_region (reused), NOT interaction.
//  4. choice_type stays 'tap_region' — this layer never touches it.

import type { TapRegion, TapRegionMode } from '../model'
import { getTemplate } from './interactionTemplates'

export const RUNTIME_VERSION = 1 // bump when a new template needs a newer player

export type AnchorMode = 'end' | 'timed_window' | 'timepoint'

// A single outcome slot. `null` in the UI model == "resume" (play through).
export type Outcome = 'resume' | { goto: string } | { seek: number }

export interface TemplateOutcomes {
  hit?: Outcome
  miss?: Outcome
  default: Outcome // required (§2 — timeout / error / a11y-skip lands here)
}

// The on-disk shape written to choices.interaction (discriminated by `template`).
export interface TemplateInteraction {
  v: 1
  min_runtime: number
  template: string
  anchor: { mode: AnchorMode; t?: number; start_s?: number; end_s?: number; once?: boolean }
  media?: { rate?: number; loop?: [number, number] }
  params?: Record<string, unknown>
  outcomes: TemplateOutcomes
}

// What the editor component holds/edits. Region is edited separately (tap_region).
export interface InteractionUIModel {
  template: string
  anchorMode: AnchorMode
  timepoint: number // timepoint mode: seconds
  timedStart: number // timed_window mode
  timedEnd: number
  once: boolean
  hitGoto: string | null
  missGoto: string | null
  defaultGoto: string | null // null = resume
  params: Record<string, unknown> // template-private, non-region
  media: { rate?: number; loopStart?: number; loopEnd?: number }
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

// Extract a goto node id from an outcome value (null if resume/seek/absent).
function outcomeGoto(o: unknown): string | null {
  if (isObj(o) && typeof o.goto === 'string') return o.goto
  return null
}

function makeDefault(template: string): InteractionUIModel {
  return {
    template,
    anchorMode: 'end',
    timepoint: 0,
    timedStart: 0,
    timedEnd: 0,
    once: false,
    hitGoto: null,
    missGoto: null,
    defaultGoto: null,
    params: {},
    media: {},
  }
}

// ── parse: raw jsonb + tap_region → editor UI model ──────────────────────────
// Three-state read mapping (§2, aligned with Player runtime):
//  ① interaction has `template` → new template model.
//  ② no template but tap_region.mode → map the v2 gesture to a "basic" card;
//     region stays in tap_region, default goto = the choice's target_node_id.
//  ③ neither → basic 'tap'.
export function parseInteraction(
  interaction: unknown,
  tapRegion: TapRegion | null,
  targetNodeId: string | null,
): InteractionUIModel {
  // ① new template schema
  if (isObj(interaction) && typeof interaction.template === 'string') {
    const anchor = isObj(interaction.anchor) ? interaction.anchor : {}
    const outcomes = isObj(interaction.outcomes) ? interaction.outcomes : {}
    const media = isObj(interaction.media) ? interaction.media : {}
    const loop = Array.isArray(media.loop) ? (media.loop as number[]) : []
    const anchorMode = ((): AnchorMode => {
      const m = anchor.mode
      return m === 'timed_window' || m === 'timepoint' ? m : 'end'
    })()
    return {
      template: interaction.template,
      anchorMode,
      timepoint: typeof anchor.t === 'number' ? anchor.t : 0,
      timedStart: typeof anchor.start_s === 'number' ? anchor.start_s : 0,
      timedEnd: typeof anchor.end_s === 'number' ? anchor.end_s : 0,
      once: anchor.once === true,
      hitGoto: outcomeGoto(outcomes.hit),
      missGoto: outcomeGoto(outcomes.miss),
      defaultGoto: outcomeGoto(outcomes.default),
      params: isObj(interaction.params) ? interaction.params : {},
      media: {
        rate: typeof media.rate === 'number' ? media.rate : undefined,
        loopStart: typeof loop[0] === 'number' ? loop[0] : undefined,
        loopEnd: typeof loop[1] === 'number' ? loop[1] : undefined,
      },
    }
  }

  // ② legacy v2 gesture in tap_region (no template) → basic card
  const legacyMode = tapRegion?.mode
  if (legacyMode && ['tap', 'swipe', 'rapid_tap', 'hold'].includes(legacyMode)) {
    const model = makeDefault(legacyMode)
    // v2 timed window → timed_window anchor; else after-end
    const win = tapRegion?.window
    if (win?.type === 'timed') {
      model.anchorMode = 'timed_window'
      model.timedStart = win.start_s
      model.timedEnd = win.end_s
    }
    model.defaultGoto = targetNodeId // §2.1.1: existing routing = target_node_id
    return model
  }

  // ③ nothing (or a bare {x,y,w,h} tap_region) → basic tap
  const model = makeDefault('tap')
  model.defaultGoto = targetNodeId
  return model
}

// ── serialize: UI model → what to persist ────────────────────────────────────
// Returns the interaction jsonb, an optional tap_region.mode patch (keep the
// existing region rectangle, just align its mode for basic templates so the v2
// runtime + player degradation stay consistent), and the target_node_id that
// MUST equal outcomes.default.goto (§2.1.1).
export interface SerializedInteraction {
  interaction: TemplateInteraction
  // Basic templates (tap/swipe/rapid_tap/hold) are performed by the player's v2
  // gesture engine, which reads choice.tap_region.{mode,swipe,rapid_tap,hold,style}
  // — NOT interaction. So mirror the gesture into tap_region (the caller merges it
  // onto the existing {x,y,w,h}); without this a "swipe" set only in interaction
  // renders as the default tap. null for advanced templates → leave tap_region alone.
  tapRegionGesture: Partial<TapRegion> | null
  targetNodeId: string | null // §2.1.1 invariant — write alongside
}

const gotoOrResume = (id: string | null): Outcome => (id ? { goto: id } : 'resume')

// Only hotspot_collect — a "collect until found" task with no intrinsic fail state —
// supports endless mode: no time limit → wait + retry until the player collects K,
// then only the success exit matters (default pinned to hit, miss dropped). The
// skill/timing templates (bullet_time / combo_rated / timing_meter / roaming_reticle)
// are DEFINED by their time pressure — without a limit they're trivial — so they
// always keep the fail/timeout branch and require a positive window (see
// TIMED_REQUIRED validation). (Shangyu 2026-08, corrected)
export function isEndlessInteraction(model: InteractionUIModel): boolean {
  if (model.template !== 'hotspot_collect') return false
  const w = model.params.window
  return !(typeof w === 'number' && w > 0)
}

// Skill/timing templates whose challenge is the time pressure itself — a positive
// `window` (time limit) is required, else the interaction is trivial/meaningless.
export const TIMED_REQUIRED = new Set(['bullet_time', 'combo_rated', 'timing_meter', 'roaming_reticle'])

export function serializeInteraction(model: InteractionUIModel): SerializedInteraction {
  const tpl = getTemplate(model.template)
  const slots = tpl?.outcomes ?? ['default']
  const endless = isEndlessInteraction(model)

  const outcomes: TemplateOutcomes = {
    default: gotoOrResume(endless ? model.hitGoto : model.defaultGoto),
  }
  if (slots.includes('hit')) outcomes.hit = gotoOrResume(model.hitGoto)
  if (slots.includes('miss') && !endless) outcomes.miss = gotoOrResume(model.missGoto)

  const anchor: TemplateInteraction['anchor'] = { mode: model.anchorMode }
  if (model.anchorMode === 'timepoint') anchor.t = model.timepoint
  if (model.anchorMode === 'timed_window') {
    anchor.start_s = model.timedStart
    anchor.end_s = model.timedEnd
  }
  if (model.once) anchor.once = true

  const media: TemplateInteraction['media'] = {}
  if (typeof model.media.rate === 'number') media.rate = model.media.rate
  if (typeof model.media.loopStart === 'number' && typeof model.media.loopEnd === 'number') {
    media.loop = [model.media.loopStart, model.media.loopEnd]
  }

  const interaction: TemplateInteraction = {
    v: 1,
    min_runtime: RUNTIME_VERSION,
    template: model.template,
    anchor,
    outcomes,
    ...(Object.keys(media).length ? { media } : {}),
    ...(Object.keys(model.params).length ? { params: model.params } : {}),
  }

  // Basic templates are driven by the v2 gesture engine via tap_region, so mirror
  // the gesture (mode + its params + style) into tap_region; the caller merges it
  // onto the existing {x,y,w,h}. Advanced templates read `interaction` → no patch.
  const basicModes: TapRegionMode[] = ['tap', 'swipe', 'rapid_tap', 'hold']
  let tapRegionGesture: Partial<TapRegion> | null = null
  if (basicModes.includes(model.template as TapRegionMode)) {
    const p = model.params
    const g: Partial<TapRegion> = { mode: model.template as TapRegionMode }
    if (typeof p.style === 'string' && p.style) g.style = p.style
    if (model.template === 'swipe') {
      const d = p.direction
      g.swipe = { direction: d === 'down' || d === 'left' || d === 'right' ? d : 'up' }
    } else if (model.template === 'rapid_tap') {
      g.rapid_tap = { count: typeof p.count === 'number' ? p.count : 5 }
    } else if (model.template === 'hold') {
      g.hold = { duration_ms: (typeof p.duration === 'number' ? p.duration : 1.5) * 1000 }
    }
    tapRegionGesture = g
  }

  return {
    interaction,
    tapRegionGesture,
    // §2.1.1: old-app routing must match new-app degradation.
    targetNodeId: endless ? model.hitGoto : model.defaultGoto,
  }
}

// ── validate: write-time guard (§2.1.2 — the MAIN defense, not publish) ───────
export interface InteractionIssue {
  field: string
  message: string
}

export function validateInteraction(
  model: InteractionUIModel,
  liveNodeIds: Set<string>,
): InteractionIssue[] {
  const issues: InteractionIssue[] = []
  const tpl = getTemplate(model.template)
  const slots = tpl?.outcomes ?? ['default']

  const checkGoto = (field: string, id: string | null, required: boolean) => {
    if (id == null) {
      if (required) issues.push({ field, message: 'interaction_tpl.val.goto_required' })
      return
    }
    if (!liveNodeIds.has(id)) issues.push({ field, message: 'interaction_tpl.val.goto_missing' })
  }

  // hit/miss are required when the template exposes them; default may be resume.
  // Endless mode (no time limit): only the success exit is wired — default is
  // pinned to hit and miss is dropped, so don't require them.
  const endless = isEndlessInteraction(model)
  if (slots.includes('hit')) checkGoto('hit', model.hitGoto, true)
  if (slots.includes('miss') && !endless) checkGoto('miss', model.missGoto, true)
  if (!endless) checkGoto('default', model.defaultGoto, false)

  // Skill/timing templates need a positive time limit — that pressure IS the mechanic.
  if (TIMED_REQUIRED.has(model.template)) {
    const w = model.params.window
    if (!(typeof w === 'number' && w > 0)) {
      issues.push({ field: 'window', message: 'interaction_tpl.val.window_required' })
    }
  }

  if (model.anchorMode === 'timepoint' && model.timepoint < 0) {
    issues.push({ field: 'anchor', message: 'interaction_tpl.val.timepoint_neg' })
  }
  if (model.anchorMode === 'timed_window' && model.timedEnd <= model.timedStart) {
    issues.push({ field: 'anchor', message: 'interaction_tpl.val.timed_order' })
  }
  if (typeof model.media.rate === 'number' && (model.media.rate <= 0 || model.media.rate > 4)) {
    issues.push({ field: 'media.rate', message: 'interaction_tpl.val.rate_range' })
  }

  // wipe_reveal: an all-zero config is a silent no-op (0% reveal = instant "hit",
  // 0px brush = nothing to rub). Force a meaningful threshold + brush.
  if (model.template === 'wipe_reveal') {
    const th = model.params.threshold
    if (typeof th !== 'number' || th < 1 || th > 100) {
      issues.push({ field: 'threshold', message: 'interaction_tpl.val.threshold_range' })
    }
    const br = model.params.brush
    if (typeof br === 'number' && br < 1) {
      issues.push({ field: 'brush', message: 'interaction_tpl.val.brush_range' })
    }
  }

  // roaming_reticle: centered target must be a sane fraction of the walk range.
  if (model.template === 'roaming_reticle') {
    const ts = model.params.targetSize
    if (typeof ts === 'number' && (ts <= 0 || ts > 1)) {
      issues.push({ field: 'targetSize', message: 'interaction_tpl.val.target_size_range' })
    }
  }
  // timing_meter: green + both yellow bands must fit inside the bar (rest = red).
  if (model.template === 'timing_meter') {
    const g = typeof model.params.greenFrac === 'number' ? model.params.greenFrac : 0.2
    const y = typeof model.params.yellowFrac === 'number' ? model.params.yellowFrac : 0.15
    if (g <= 0 || g > 1 || y < 0 || g + 2 * y > 1) {
      issues.push({ field: 'greenFrac', message: 'interaction_tpl.val.zones_overflow' })
    }
  }
  return issues
}

// Collect every node id referenced by a choice's interaction outcomes — used by
// deleteNode to scrub dangling goto refs when a target node is removed (§2.1.3).
export function interactionGotoRefs(interaction: unknown): string[] {
  if (!isObj(interaction) || typeof interaction.template !== 'string') return []
  const outcomes = isObj(interaction.outcomes) ? interaction.outcomes : {}
  return [outcomes.hit, outcomes.miss, outcomes.default]
    .map(outcomeGoto)
    .filter((id): id is string => id != null)
}

// §2.1.3: when node `deletedId` is removed, replace any outcome goto that points
// at it with 'resume' so no dangling goto ships (048 auto-republish would
// otherwise push it to players, where the branch silently dies). Returns the
// cleaned interaction + whether the DEFAULT slot was scrubbed (the caller must
// then null target_node_id to keep §2.1.1's invariant). Returns null when
// nothing referenced the deleted node (no write needed). Non-template / legacy
// interactions are left untouched.
export function scrubInteractionGotos(
  interaction: unknown,
  deletedId: string,
): { interaction: TemplateInteraction; defaultScrubbed: boolean } | null {
  if (!isObj(interaction) || typeof interaction.template !== 'string') return null
  const outcomes = isObj(interaction.outcomes) ? interaction.outcomes : {}
  let changed = false
  let defaultScrubbed = false
  const next: Record<string, Outcome> = {}
  for (const slot of ['hit', 'miss', 'default'] as const) {
    const o = outcomes[slot]
    if (o === undefined) continue
    if (outcomeGoto(o) === deletedId) {
      next[slot] = 'resume'
      changed = true
      if (slot === 'default') defaultScrubbed = true
    } else {
      next[slot] = o as Outcome
    }
  }
  if (!changed) return null
  // Ensure default stays present (it's required).
  if (next.default === undefined) next.default = 'resume'
  return {
    interaction: { ...(interaction as unknown as TemplateInteraction), outcomes: next as unknown as TemplateOutcomes },
    defaultScrubbed,
  }
}
