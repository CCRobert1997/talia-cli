// Interaction template catalog — single source for the gallery + jsonb writer.
// See task_prompts/design_anchor_track_templates_v1.md §4.
//
// Display strings are i18n keys resolved at render time:
//   name  → t(`interaction_tpl.tpl.${id}.name`)
//   desc  → t(`interaction_tpl.tpl.${id}.desc`)
//   tag   → t(`interaction_tpl.tag.${tagId}`)
//   param → t(`interaction_tpl.p.${id}.${paramKey}`)
// en + zh are populated; other locales fall back to en (fallbackLng). The
// stored choice_type stays 'tap_region' (display label only becomes "互动").

export type TemplateGroup = 'basic' | 'advanced'
export type OutcomeSlot = 'hit' | 'miss' | 'default'
export type ParamType = 'region' | 'regions' | 'goto' | 'int' | 'float' | 'seconds' | 'mask' | 'style' | 'var' | 'orientation'

export interface TemplateParam {
  key: string
  type: ParamType
  advanced?: boolean // folded into the 高级 section
}

export interface InteractionTemplate {
  id: string
  group: TemplateGroup
  tags: string[] // tag ids → i18n via interaction_tpl.tag.<id>
  outcomes: OutcomeSlot[]
  params: TemplateParam[] // required (top) + advanced (folded), in display order
}

// i18n key helpers (component calls t() on these).
export const tplNameKey = (id: string) => `interaction_tpl.tpl.${id}.name`
export const tplDescKey = (id: string) => `interaction_tpl.tpl.${id}.desc`
export const tplTagKey = (tagId: string) => `interaction_tpl.tag.${tagId}`
export const tplParamKey = (id: string, paramKey: string) => `interaction_tpl.p.${id}.${paramKey}`
export const tplSharedKey = (key: string) => `interaction_tpl.shared.${key}`

export const INTERACTION_TEMPLATES: InteractionTemplate[] = [
  { id: 'tap', group: 'basic', tags: ['common'], outcomes: ['default'],
    params: [
      { key: 'region', type: 'region' },
      { key: 'target', type: 'goto' },
      { key: 'style', type: 'style', advanced: true },
    ] },
  { id: 'swipe', group: 'basic', tags: ['common', 'combat'], outcomes: ['default'],
    params: [
      { key: 'region', type: 'region' },
      { key: 'target', type: 'goto' },
      { key: 'direction', type: 'style', advanced: true },
      { key: 'style', type: 'style', advanced: true },
    ] },
  { id: 'rapid_tap', group: 'basic', tags: ['combat'], outcomes: ['default'],
    params: [
      { key: 'region', type: 'region' },
      { key: 'target', type: 'goto' },
      { key: 'count', type: 'int', advanced: true },
      { key: 'style', type: 'style', advanced: true },
    ] },
  { id: 'hold', group: 'basic', tags: ['common'], outcomes: ['default'],
    params: [
      { key: 'region', type: 'region' },
      { key: 'target', type: 'goto' },
      { key: 'duration', type: 'seconds', advanced: true },
      { key: 'style', type: 'style', advanced: true },
    ] },
  { id: 'bullet_time', group: 'advanced', tags: ['combat', 'dodge'], outcomes: ['hit', 'miss', 'default'],
    params: [
      { key: 'region', type: 'region' },
      { key: 'hit', type: 'goto' },
      { key: 'miss', type: 'goto' },
      { key: 'rate', type: 'float', advanced: true },
      { key: 'window', type: 'seconds', advanced: true },
      { key: 'style', type: 'style', advanced: true },
    ] },
  { id: 'combo_rated', group: 'advanced', tags: ['combat', 'rhythm'], outcomes: ['hit', 'miss', 'default'],
    params: [
      { key: 'count', type: 'int' },
      { key: 'window', type: 'seconds' },
      { key: 'hit', type: 'goto' },
      { key: 'miss', type: 'goto' },
      { key: 'perfect', type: 'int', advanced: true },
      { key: 'ratingVar', type: 'var', advanced: true },
    ] },
  { id: 'hotspot_collect', group: 'advanced', tags: ['search', 'puzzle'], outcomes: ['hit', 'default'],
    params: [
      { key: 'regions', type: 'regions' },
      { key: 'needK', type: 'int' },
      { key: 'hit', type: 'goto' },
      { key: 'findVars', type: 'var', advanced: true },
      { key: 'window', type: 'seconds', advanced: true },
    ] },
  { id: 'wipe_reveal', group: 'advanced', tags: ['search', 'mystery'], outcomes: ['hit', 'default'],
    params: [
      { key: 'mask', type: 'mask' },
      { key: 'threshold', type: 'int' },
      { key: 'hit', type: 'goto' },
      { key: 'brush', type: 'int', advanced: true },
    ] },
  // Roaming reticle (A1): a light point random-walks inside the region (walk range),
  // tap to stop; stopping inside the centered target zone = hit (shooting crosshair).
  { id: 'roaming_reticle', group: 'advanced', tags: ['combat', 'skill'], outcomes: ['hit', 'miss', 'default'],
    params: [
      { key: 'region', type: 'region' },
      { key: 'hit', type: 'goto' },
      { key: 'miss', type: 'goto' },
      { key: 'targetSize', type: 'float', advanced: true },
      { key: 'speed', type: 'float', advanced: true },
      { key: 'window', type: 'seconds', advanced: true },
    ] },
  // Timing meter (B2): a symmetric gradient bar (green center / yellow / red) drawn
  // in the region; a marker sweeps back and forth; tap on green/yellow = hit, red =
  // miss; the grade (perfect/good/miss) is written to ratingVar.
  { id: 'timing_meter', group: 'advanced', tags: ['rhythm', 'skill'], outcomes: ['hit', 'miss', 'default'],
    params: [
      { key: 'region', type: 'region' },
      { key: 'orientation', type: 'orientation' },
      { key: 'hit', type: 'goto' },
      { key: 'miss', type: 'goto' },
      { key: 'greenFrac', type: 'float', advanced: true },
      { key: 'yellowFrac', type: 'float', advanced: true },
      { key: 'speed', type: 'float', advanced: true },
      { key: 'window', type: 'seconds', advanced: true },
      { key: 'ratingVar', type: 'var', advanced: true },
    ] },
]

// A hotspot with no regions plays as an instant skip (player: regions.length===0 →
// default), so seed needK default hotspots spread across a centered grid — the
// creator drags them to the real hiding spots. Same normalized {x,y,w,h} contract
// the player reads (0..1 of the media frame).
export function defaultHotspotRegions(needK: number): { x: number; y: number; w: number; h: number }[] {
  const k = Math.max(1, Math.min(8, needK))
  const size = 0.14
  const cols = Math.min(k, 3)
  const rows = Math.ceil(k / cols)
  const out: { x: number; y: number; w: number; h: number }[] = []
  for (let i = 0; i < k; i++) {
    const col = i % cols, row = Math.floor(i / cols)
    const cx = (col + 1) / (cols + 1)
    const cy = rows === 1 ? 0.45 : (row + 1) / (rows + 1)
    out.push({ x: +(cx - size / 2).toFixed(3), y: +(cy - size / 2).toFixed(3), w: size, h: size })
  }
  return out
}

// Sensible starting params seeded when a template is FIRST selected (design §4).
// Avoids the "everything is 0 → interaction is a no-op" trap (e.g. a wipe with
// threshold 0 succeeds on the first touch). Only `params`-typed fields live here;
// media.rate keeps its own runtime default (0.3). Merged over on template switch.
export const TEMPLATE_DEFAULT_PARAMS: Record<string, Record<string, unknown>> = {
  bullet_time: { window: 3 },
  combo_rated: { count: 8, window: 3, perfect: 12 },
  hotspot_collect: { needK: 3 },
  wipe_reveal: { threshold: 60, brush: 40, mask: '@current_frame' },
  roaming_reticle: { targetSize: 0.3, speed: 1, window: 3 },
  timing_meter: { orientation: 'horizontal', greenFrac: 0.2, yellowFrac: 0.15, speed: 1, window: 4 },
}

// Mask cover sentinel: the cover is a freeze of THIS node's frame at trigger time
// (last frame for After end; the played-to frame for Timed/Timepoint). Player-end
// snapshots the current video frame; distinguished from a color (#hex) or image URL.
export const MASK_CURRENT_FRAME = '@current_frame'

export const defaultParamsFor = (id: string): Record<string, unknown> => {
  const base = { ...(TEMPLATE_DEFAULT_PARAMS[id] ?? {}) }
  // Seed hotspot_collect with needK placed regions so it never starts empty (an
  // empty hotspot plays as an instant skip). Fresh array per call — never shared.
  if (id === 'hotspot_collect') {
    const needK = typeof base.needK === 'number' ? base.needK : 3
    base.regions = defaultHotspotRegions(needK)
  }
  return base
}

// Cross-template fields, always folded into 高级 (design §4). key → i18n via
// interaction_tpl.shared.<key>.
export const SHARED_ADVANCED_FIELDS: string[] = ['hint', 'hintStyle', 'condition', 'achievement', 'once']

export const templatesByGroup = (group: TemplateGroup) =>
  INTERACTION_TEMPLATES.filter(t => t.group === group)

export const getTemplate = (id: string) => INTERACTION_TEMPLATES.find(t => t.id === id)
