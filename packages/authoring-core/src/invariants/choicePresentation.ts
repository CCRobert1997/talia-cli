// Choice presentation — the "呈现轴" of the choice spectrum (design
// design_choice_presentation_spectrum.md). Orthogonal to economics (choice_type)
// and judgment (gesture/template). Rides on `choices.interaction` jsonb as a
// SIBLING key `presentation` — zero migration, snapshot already carries the column.
//
// 🔴 Storage discipline: choice_type is NEVER changed (a styled/positioned button
// stays choice_type='normal'/'paid'). Old players that can't read `presentation`
// fall back to the default bottom bar — pure progressive enhancement, the choice's
// meaning (where it goes) is unchanged, so content never dies.
//
// 🔴 Write rule: a presentation-only interaction must carry NO `mode`/`template`
// keys (those are the player's positive-signal discriminators for gesture/template
// routing). writePresentation only ever adds/removes the `presentation` key.

export type PresentationAnchor = 'bar' | 'frame'
export type PresentationSize = 's' | 'm' | 'l'

export interface ChoicePresentation {
  anchor: PresentationAnchor
  // frame anchor only: normalized 0..1 CENTER of the button, same coord system as
  // tap_region (contain-fit letterbox mapping on the player).
  pos?: { x: number; y: number }
  w?: number            // button width as fraction of media width (frame only)
  skin: string          // 'default' | 'preset:<id>' | 'image:<r2_url>'
  font?: string         // whitelist id (absent = default)
  size: PresentationSize
  narration?: string    // 决策旁白, node-level semantics stored on the sort-min choice
}

// CSS-implemented style ids (NOT images). Shared id namespace — the same ids will
// later feed tap_region hint rendering (second step, not this phase).
export const SKIN_PRESET_IDS = ['outline', 'gilded', 'film', 'romance'] as const
export type SkinPresetId = (typeof SKIN_PRESET_IDS)[number]

// Font whitelist (Producer proposal; Player must confirm native packaging before
// the player build ships these). id → CSS stack (web editor preview loads them via
// the Google Fonts <link> in index.html). NOT open to arbitrary upload (copyright +
// native must pre-bundle). A decorative font only covers its own script and falls
// back for others (`script` documents primary coverage for the picker + packaging).
// Coverage across Talia's 10 locales: Latin (en/es/fr/de/pt) + Cyrillic (ru) via the
// Latin display faces; CJK (zh, partial ja) via Noto SC / brush faces; Arabic (ar)
// via Cairo. Full ja/ko kana·hangul is a follow-up (needs Noto Sans JP/KR).
export interface PresentationFont { id: string; stack: string; script: 'latin' | 'cjk' | 'arabic' | 'all' }
export const PRESENTATION_FONTS: PresentationFont[] = [
  { id: 'default', stack: 'inherit', script: 'all' },
  // Latin (+ Cyrillic where noted) display faces
  { id: 'modak', stack: "'Modak', system-ui, sans-serif", script: 'latin' },
  { id: 'playfair', stack: "'Playfair Display', Georgia, serif", script: 'latin' },
  { id: 'bebas', stack: "'Bebas Neue', Impact, sans-serif", script: 'latin' },
  { id: 'oswald', stack: "'Oswald', 'Arial Narrow', sans-serif", script: 'latin' },
  { id: 'pacifico', stack: "'Pacifico', cursive", script: 'latin' },
  { id: 'anton', stack: "'Anton', Impact, sans-serif", script: 'latin' },
  // CJK faces
  { id: 'noto_sans_sc', stack: "'Noto Sans SC', sans-serif", script: 'cjk' },
  { id: 'noto_serif_sc', stack: "'Noto Serif SC', serif", script: 'cjk' },
  { id: 'ma_shan_zheng', stack: "'Ma Shan Zheng', cursive", script: 'cjk' },
  { id: 'long_cang', stack: "'Long Cang', cursive", script: 'cjk' },
  // Arabic (+ Latin)
  { id: 'cairo', stack: "'Cairo', system-ui, sans-serif", script: 'arabic' },
]
export const PRESENTATION_FONT_IDS = PRESENTATION_FONTS.map(f => f.id)
export const fontStack = (id: string | undefined): string =>
  PRESENTATION_FONTS.find(f => f.id === id)?.stack ?? 'inherit'

export const PRESENTATION_SIZES: PresentationSize[] = ['s', 'm', 'l']

export const DEFAULT_PRESENTATION: ChoicePresentation = { anchor: 'bar', skin: 'default', size: 'm' }

const KEY = 'presentation'
const NARRATION_MAX = 280

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const clampRange = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
const round3 = (n: number) => +n.toFixed(3)

export function isValidSkin(skin: unknown): boolean {
  if (typeof skin !== 'string') return false
  if (skin === 'default') return true
  if (skin.startsWith('preset:')) return (SKIN_PRESET_IDS as readonly string[]).includes(skin.slice(7))
  if (skin.startsWith('image:')) return /^https?:\/\/\S+/i.test(skin.slice(6))
  return false
}

export const isImageSkin = (skin: string | undefined): boolean => !!skin && skin.startsWith('image:')
export const skinImageUrl = (skin: string | undefined): string | null =>
  isImageSkin(skin) ? skin!.slice(6) : null

// Clamp/normalize a raw presentation object (write-time main defense: pos/w bounds,
// skin whitelist, size/font whitelist, narration length).
export function normalizePresentation(p: unknown): ChoicePresentation {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  const anchor: PresentationAnchor = o.anchor === 'frame' ? 'frame' : 'bar'
  const size: PresentationSize = PRESENTATION_SIZES.includes(o.size as PresentationSize)
    ? (o.size as PresentationSize)
    : 'm'
  const skin = isValidSkin(o.skin) ? (o.skin as string) : 'default'
  const out: ChoicePresentation = { anchor, skin, size }
  if (anchor === 'frame') {
    const pos = o.pos as { x?: unknown; y?: unknown } | undefined
    out.pos = { x: round3(clamp01(num(pos?.x, 0.5))), y: round3(clamp01(num(pos?.y, 0.5))) }
    if (o.w != null) out.w = round3(clampRange(num(o.w, 0.4), 0.1, 1))
  }
  if (typeof o.font === 'string' && PRESENTATION_FONT_IDS.includes(o.font) && o.font !== 'default') {
    out.font = o.font
  }
  if (typeof o.narration === 'string' && o.narration.trim()) {
    out.narration = o.narration.trim().slice(0, NARRATION_MAX)
  }
  return out
}

// A presentation identical to the default bottom button carries no information —
// store null so existing content stays byte-identical and old players are unaffected.
export function isTrivialPresentation(p: ChoicePresentation): boolean {
  return p.anchor === 'bar' && p.skin === 'default' && p.size === 'm' && !p.font && !p.narration
}

// Read the presentation off an interaction jsonb (null = default bottom button).
export function parsePresentation(interaction: unknown): ChoicePresentation | null {
  if (!interaction || typeof interaction !== 'object') return null
  const p = (interaction as Record<string, unknown>)[KEY]
  if (!p || typeof p !== 'object') return null
  return normalizePresentation(p)
}

// True when the interaction carries gesture/template content (anything but the
// presentation key) — gates the legacy InteractionSection so a presentation-only
// choice doesn't trip it, and tells writePresentation whether to collapse to null.
export function hasNonPresentationInteraction(interaction: unknown): boolean {
  if (!interaction || typeof interaction !== 'object') return false
  return Object.keys(interaction as Record<string, unknown>).some(k => k !== KEY)
}

// Merge a presentation into an interaction jsonb (or remove it), preserving every
// other key. Collapses to null when nothing is left (a plain button choice).
export function writePresentation(
  interaction: unknown,
  p: ChoicePresentation | null,
): Record<string, unknown> | null {
  const base: Record<string, unknown> =
    interaction && typeof interaction === 'object' ? { ...(interaction as Record<string, unknown>) } : {}
  if (!p || isTrivialPresentation(p)) delete base[KEY]
  else base[KEY] = normalizePresentation(p)
  return Object.keys(base).length === 0 ? null : base
}
