export type NodeType = 'normal' | 'ending' | 'start'
export type NodeStatus = 'draft' | 'active' | 'removed'
export type TriggerMode = 'end' | 'timestamp'
export type MediaType = 'video' | 'images'
export type CollabMode = 'none' | 'reviewed'
export type TransitionEffect = 'none' | 'fade' | 'slide_up' | 'flash'
export type VarType = 'bool' | 'int'
export type DisplayMode = 'hide' | 'lock'

export interface Project {
  id: string
  owner_id: string
  title: string
  description: string | null
  cover_url: string | null
  tags: string[]
  estimated_minutes: number | null
  transition_effect: TransitionEffect
  loading_video_url: string | null
  collab_mode: CollabMode
  /** @deprecated Project-level pricing retired 2026-09-10 — every project is free
   *  to enter; monetization is only via paid choices. Columns kept (normalized to
   *  free by migration 054) until fully dropped; editor/CLI no longer read/write. */
  pricing: 'free' | 'paid'
  /** @deprecated see `pricing`. */
  price_amount: number
  status: ProjectStatus
  last_rejection_reason_category: RejectionCategory | null
  last_rejection_reason_text: string | null
  bgm_asset_id: string | null
  bgm_volume: number
  start_node_id: string | null
  // Ambient theme background (migration 053, live row — not snapshotted, like BGM).
  // Player renders it on the story map / game home; editor writes it here.
  theme_bg?: ThemeBg | null
  // Subtree contribution (migration 057a): non-null marks this project as a
  // contribution draft aimed at a target story's node; null = a normal project.
  contribution_target?: ContributionTarget | null
  // Discovery surface (migration 077): 'recommend' = shows in Games/tags/For-You;
  // 'search_only' = only text-search hits. Admin-set; creator sees read-only.
  discovery?: 'recommend' | 'search_only'
  created_at: string
  updated_at: string
}

// Where a contribution project attaches in the target story (migration 057a).
export interface ContributionTarget {
  project_id: string
  node_id: string
}

// Project theme background — a named preset or a custom vertical gradient.
// 6 preset ids are locked with the player (projectTheme.ts). Clear = null →
// player renders the default (warm_dark, per Shangyu 2026-09-10; was cream_lavender).
export type ThemeBg =
  | { preset: string }
  | { colors: string[]; dark?: boolean }

export const THEME_BG_PRESETS = [
  'cream_lavender', 'dawn_peach', 'mist_blue', 'sage_glow', 'midnight', 'warm_dark',
] as const

export const isThemeHexColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)

// Framework-agnostic theme-background validator — the single write-side guard,
// reused by the editor picker and the CLI. Accepts a preset id, a custom
// 2–5-hex gradient (+ optional dark), or null (= clear → player default). Returns
// the normalized value or a human-readable error.
export function parseThemeBg(input: unknown):
  | { ok: true; value: ThemeBg | null }
  | { ok: false; error: string } {
  if (input == null) return { ok: true, value: null }
  if (typeof input !== 'object') return { ok: false, error: 'theme must be a preset id, colors, or null' }
  const o = input as Record<string, unknown>
  if (typeof o.preset === 'string') {
    if (!(THEME_BG_PRESETS as readonly string[]).includes(o.preset)) {
      return { ok: false, error: `unknown preset "${o.preset}"; valid: ${THEME_BG_PRESETS.join(', ')}` }
    }
    return { ok: true, value: { preset: o.preset } }
  }
  if (Array.isArray(o.colors)) {
    if (o.colors.length < 2 || o.colors.length > 5) return { ok: false, error: 'custom gradient needs 2–5 colors' }
    if (!o.colors.every(isThemeHexColor)) return { ok: false, error: 'each color must be a #RRGGBB hex' }
    const colors = o.colors as string[]
    return { ok: true, value: typeof o.dark === 'boolean' ? { colors, dark: o.dark } : { colors } }
  }
  return { ok: false, error: 'theme must be {preset} or {colors, dark?}' }
}

// Moderation flow (migration 034): publish puts a project into pending_review;
// an admin approves → published, or rejects → rejected (creator sees reason,
// editing any field flips it back to draft for resubmission).
export type ProjectStatus = 'draft' | 'pending_review' | 'published' | 'rejected'

export type RejectionCategory =
  | 'objectionable'
  | 'safety'
  | 'copyright'
  | 'low_quality'
  | 'other'

// AI generation recipe saved onto a node when a Seedance result is applied
// (migration 041 nodes.gen_recipe). Lets remixers/二创 reuse the exact prompt,
// refs and params that produced the node's video.
// A shareable Seedance recipe for a node (migration 041; reused by Topology
// sharing, migration 065). Only worker-payload fields that are portable across
// projects belong here — the whitelist in SeedanceStudio#applyToNode is the
// single source of truth for what gets written. Source-scoped fields
// (project_id / node_id / watermark) are deliberately excluded.
export interface GenRecipe {
  prompt?: string
  ref_urls?: string[]
  ref_mode?: string
  model?: string
  mode?: string          // 't2v' | 'v2v'
  duration?: number
  ratio?: string
  resolution?: string
  camera_fixed?: boolean
  generate_audio?: boolean
  job_id?: string
  output_url?: string
  generated_at?: string
}

// How the player physically triggers a choice (migration 041
// choices.interaction, jsonb). Orthogonal to choice_type (economics):
// null/absent = classic button after the video ends.
export type InteractionMode = 'button' | 'swipe' | 'rapid_tap' | 'hold'
export interface ChoiceInteraction {
  mode: InteractionMode
  // When the interaction is available. 'after_end' = classic post-video
  // choices UI. 'timed' = urgent mid-video window (seconds into the node's
  // media) — miss it and playback continues to timeout_target (or falls
  // through to the after-end UI if none).
  window?: { type: 'after_end' } | { type: 'timed'; start_s: number; end_s: number }
  swipe?: { direction: 'up' | 'down' | 'left' | 'right' }
  rapid_tap?: { count: number }        // consecutive taps required within the window
  hold?: { duration_ms: number }       // press-and-hold length
  timeout_target_node_id?: string | null // timed window expired → go here
}

export interface NodeMeta {
  node_id: string
  tags: string[]
  achievement_name: string | null
  prerequisite_node_ids: string[]
}

export interface StoryNode {
  id: string
  project_id: string
  contributor_id: string | null
  title: string
  video_url: string | null
  duration_s: number | null
  trigger_mode: TriggerMode
  trigger_at_s: number | null
  media_type: MediaType
  thumbnail_url: string | null
  image_urls: string[]
  canvas_x: number
  canvas_y: number
  status: NodeStatus
  node_type: NodeType
  max_branch_count: number
  min_bid_amount: number
  ai_replace_enabled: boolean
  ai_replace_segments: AiReplaceSegment[] | null
  share_as_short: boolean
  shared_as_short_at: string | null
  auto_advance: boolean
  gen_recipe?: GenRecipe | null
  // Subtree contribution copy (migrations 057b/c): a grafted copy points back at
  // its source node + source project; null on ordinary authored nodes.
  source_node_id?: string | null
  source_project_id?: string | null
  created_at: string
  updated_at: string
  meta?: NodeMeta
}

export interface ChoiceEffect {
  var_id: string
  op: 'set' | 'add'
  value: boolean | number
}

export type ChoiceType = 'normal' | 'paid' | 'ai_replace' | 'tap_region'

export interface TapRegion {
  x: number
  y: number
  w: number
  h: number
  hint?: string
  // Gesture unification (2026-07-24, no migration — tap_region is jsonb and
  // already snapshotted): a region IS the gesture surface. Default 'tap'
  // keeps every pre-existing region working unchanged.
  mode?: TapRegionMode
  // Visual style variant for the gesture hint (2026-07-24: ALL styles ship,
  // creators pick per region). Ids per mode live in lib/gestureStyles.ts;
  // absent = the mode's default style.
  style?: string
  // Style variant for the timed-window countdown visual (top_bar default).
  window_style?: string
  swipe?: { direction: 'up' | 'down' | 'left' | 'right' }
  rapid_tap?: { count: number }
  hold?: { duration_ms: number }
  // after_end (default) or an urgent mid-video window.
  window?: { type: 'after_end' } | { type: 'timed'; start_s: number; end_s: number }
  timeout_target_node_id?: string | null
}

export type TapRegionMode = 'tap' | 'swipe' | 'rapid_tap' | 'hold'

export interface Choice {
  id: string
  node_id: string
  label: string
  target_node_id: string | null
  choice_type: ChoiceType
  tacoin_cost: number | null
  ai_replace_node_id: string | null
  paid_var_id: string | null
  display_mode: DisplayMode
  condition_expr: ConditionExpr | null
  effects: ChoiceEffect[] | null
  grants_achievement_id: string | null
  sort_order: number
  tap_region: TapRegion | null
  interaction?: ChoiceInteraction | null
  created_at: string
}

export interface Achievement {
  id: string
  project_id: string
  name: string
  description: string | null
  emoji: string
  condition_expr: ConditionExpr | null
  created_at: string
  updated_at: string
}

export interface Variable {
  id: string
  project_id: string
  name: string
  var_type: VarType
  default_value: boolean | number
  min_value: number | null
  max_value: number | null
  created_at: string
}

export type SingleCondition =
  | { type: 'bool'; var_id: string; op: 'eq' | 'neq'; value: boolean }
  | { type: 'int'; var_id: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }

export type ConditionExpr =
  | SingleCondition
  | { type: 'and'; conditions: SingleCondition[] }
  | { type: 'or'; conditions: SingleCondition[] }
  | null

export interface AiReplaceMask {
  annotation_frame_idx: number
  video_width: number
  video_height: number
  positive: { x: number; y: number }[]
  negative: { x: number; y: number }[]
}

export interface AiReplaceSegment {
  id: string
  type: 'normal' | 'ai_replace'
  video_url: string | null
  tacoin_cost: number | null
  mask: AiReplaceMask | null
}

export type AssetKind = 'video' | 'image' | 'audio' | 'other'

export interface Asset {
  id: string
  owner_id: string
  project_id: string
  kind: AssetKind
  bucket: string
  r2_key: string
  r2_url: string
  original_filename: string | null
  mime_type: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  duration_ms: number | null
  // Migration 042: folder organization + remix sharing + AI-gen lineage
  folder_id?: string | null
  remixable?: boolean
  gen_job_id?: string | null
  created_at: string
}

// Migration 042: single-level asset folders. Folder-level remixable toggle
// bulk-applies to member assets (no runtime inheritance — RLS reads only
// assets.remixable).
export interface AssetFolder {
  id: string
  project_id: string
  owner_id: string
  name: string
  remixable: boolean
  created_at: string
}

export interface CollabSubmission {
  id: string
  project_id: string
  contributor_id: string
  parent_node_id: string
  title: string
  media_type: MediaType
  video_url: string | null
  segment_urls: string[] | null
  image_urls: string[]
  trigger_mode: TriggerMode
  proposed_choices: Record<string, unknown> | null
  status: 'pending' | 'accepted' | 'rejected'
  reviewed_at: string | null
  published_node_id: string | null
  // Owner's rejection reason (shown to the contributor) / contributor's note to the
  // owner. Columns predate the subtree work; reviewer_note is written via the 2-arg
  // settle_branch_bid_reject (migration 061).
  reviewer_note?: string | null
  contributor_note?: string | null
  // Subtree submission (migration 057a): the contributor's own project the branch
  // is grafted FROM. Non-null = subtree submission; null = classic single-video.
  source_project_id?: string | null
  created_at: string
}
