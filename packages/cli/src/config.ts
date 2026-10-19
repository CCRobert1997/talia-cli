// CLI config + credential store (~/.talia/). Supabase url/anon key come from env
// (SUPABASE_URL / SUPABASE_ANON_KEY) or ~/.talia/config.json; the anon key is public,
// RLS scopes every write to the logged-in owner. The saved session is the creator's
// own access/refresh token from `talia login`.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const DIR = join(homedir(), '.talia')
const CONFIG = join(DIR, 'config.json')
const CREDS = join(DIR, 'credentials.json')

// The project URL + anon key are PUBLIC (already shipped in the web client bundle;
// RLS protects all data, and every write goes through owner-scoped RPCs). Baked in
// so creators just run `talia login` — no key hunting. Override via env/config for
// other environments (e.g. staging).
const DEFAULT_URL = 'https://jbknghsqbbgjqjwlhlke.supabase.co'
const DEFAULT_ANON_KEY = 'sb_publishable_f52xWqgGf1osCCu8f-hl8g_ulHO7lyK'

function readJson<T>(path: string): T | null {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null } catch { return null }
}
function writeJson(path: string, data: unknown): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

export interface SupabaseConfig { url: string; anonKey: string }

export function getSupabaseConfig(): SupabaseConfig {
  const fromFile = readJson<Partial<SupabaseConfig>>(CONFIG) ?? {}
  const url = process.env.SUPABASE_URL ?? fromFile.url ?? DEFAULT_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? fromFile.anonKey ?? DEFAULT_ANON_KEY
  return { url, anonKey }
}

export interface SavedSession { access_token: string; refresh_token: string; email?: string }

export const saveSession = (s: SavedSession): void => writeJson(CREDS, s)
export const loadSession = (): SavedSession | null => readJson<SavedSession>(CREDS)
export const clearSession = (): void => { if (existsSync(CREDS)) writeFileSync(CREDS, '{}') }
