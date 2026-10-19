/**
 * Gesture hint style catalog (2026-07-24 verdict: ALL styles ship, creators
 * pick per region; first entry per mode = default). Ids are the schema values
 * stored in tap_region.style / tap_region.window_style — the player end must
 * implement every id here (see task_prompts/player_choice_interactions.md).
 * Visual reference: content_game_talia/design_demos/interaction_modes_demo.html
 * Display labels live in i18n under `gesture_style.<mode>.<id>` and
 * `gesture_style.window.<id>` (all 10 locales).
 */
import type { TapRegionMode } from '../model'

export const GESTURE_STYLES: Record<TapRegionMode, string[]> = {
  swipe: ['ghost_arrow', 'chevron_flow', 'trail', 'pulse_band', 'grabber', 'particles'],
  tap: ['dot', 'ripple', 'fingertip', 'focus_brackets', 'glow', 'border_breathe'],
  rapid_tap: ['count_ring', 'burst_number', 'shaking_badge', 'pips', 'combo_sparks'],
  hold: ['fill_ring', 'flood', 'close_in', 'hold_bar', 'grow_dot'],
}

export const WINDOW_STYLES: string[] = ['top_bar', 'border_sweep', 'count_chip', 'vignette', 'mini_clock']

export function defaultStyle(mode: TapRegionMode): string {
  return GESTURE_STYLES[mode][0]
}

export const gestureStyleKey = (mode: TapRegionMode, id: string) => `gesture_style.${mode}.${id}`
export const windowStyleKey = (id: string) => `gesture_style.window.${id}`
