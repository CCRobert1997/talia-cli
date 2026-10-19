// Authed Supabase client for the CLI. `talia login` saves the creator's session;
// getAuthedClient restores it so core ops run under that user (RLS scopes to owner).
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { getSupabaseConfig, saveSession, loadSession } from './config'

function bareClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig()
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function login(email: string, password: string): Promise<User> {
  const client = bareClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.session) throw new Error('No session returned')
  saveSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    email: data.user?.email ?? email,
  })
  return data.user
}

// A client carrying the saved session. Throws if not logged in.
export async function getAuthedClient(): Promise<{ client: SupabaseClient; user: User }> {
  const session = loadSession()
  if (!session?.access_token) throw new Error('Not logged in. Run: talia login')
  const client = bareClient()
  const { data, error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw new Error(`Session expired — run: talia login (${error.message})`)
  if (!data.user) throw new Error('Not logged in. Run: talia login')
  return { client, user: data.user }
}
