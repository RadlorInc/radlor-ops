import 'server-only'
import { SCHEMA } from './db'
import { currentUser } from './session'

/**
 * Reads and writes the admin tables AS THE SIGNED-IN USER.
 *
 * ⚠️ THE ANON KEY AND THE USER'S TOKEN — NEVER THE SERVICE KEY. That is the whole point of the RLS
 * added in phase 1: the row arrives because `subs_admin_read` allowed it, not because the app
 * checked a role first and then read as a superuser. Reading with `service_role` here would work
 * identically whether the policies were correct or missing, and the policies would be decoration.
 *
 * The consequence to keep in mind: a tester's token reaching these functions gets an empty list and
 * a refused write, from the database, without this module doing anything about it.
 */

export type Subscription = {
  id: string
  tool: string
  plan: string | null
  renewal_date: string | null
  monthly_cost: string | null
  credits_remaining: string | null
  credits_source: 'manual' | 'api'
  last_updated: string
  sort_order: number
}

export type Todo = {
  id: string
  task: string
  status: 'not_started' | 'in_progress' | 'done'
  area: string | null
  sort_order: number
}

async function asUser<T>(label: string, path: string, init?: RequestInit): Promise<T> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  const user = await currentUser()
  if (!url || !anon) throw new Error('supabase env missing')
  if (!user) throw new Error(`${label}: not signed in`)

  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
      'Accept-Profile': SCHEMA,
      'Content-Profile': SCHEMA,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    // Body only, never the path — same rule as db.ts, for the same reason.
    throw new Error(`${label} failed ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  }
  if (res.status === 204) return null as T
  return (await res.json()) as T
}

export function listSubscriptions(): Promise<Subscription[]> {
  return asUser<Subscription[]>(
    'subscriptions',
    'subscriptions?select=id,tool,plan,renewal_date,monthly_cost,credits_remaining,credits_source,last_updated,sort_order&order=sort_order.asc,tool.asc',
  )
}

export function listTodos(): Promise<Todo[]> {
  return asUser<Todo[]>('todos', 'todos?select=id,task,status,area,sort_order&order=sort_order.asc,created_at.asc')
}

export function insertTodo(row: { task: string; area: string | null; sort_order: number }): Promise<Todo[]> {
  return asUser<Todo[]>('todo insert', 'todos', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
}

export function patchTodo(id: string, patch: Partial<Pick<Todo, 'task' | 'status' | 'sort_order'>>): Promise<null> {
  return asUser<null>('todo update', `todos?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  })
}

export function insertSubscription(row: Record<string, unknown>): Promise<Subscription[]> {
  return asUser<Subscription[]>('subscription insert', 'subscriptions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
}

export function patchSubscription(id: string, patch: Record<string, unknown>): Promise<null> {
  return asUser<null>('subscription update', `subscriptions?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, last_updated: new Date().toISOString() }),
  })
}

export type Issue = {
  id: string
  reporter: string | null
  imported_from: string | null
  description: string
  area: string | null
  type: string | null
  chapter: string | null
  all_chapters: boolean
  age_band: string | null
  status: 'open' | 'ready_for_retest' | 'resolved'
  created_at: string
}

const ISSUE_COLS =
  'id,reporter,imported_from,description,area,type,chapter,all_chapters,age_band,status,created_at'

/**
 * ⚠️ NO `reporter` FILTER HERE, AND THAT IS THE POINT. `issues_read_own` returns a tester their own
 * rows and an admin everyone's — the same query, two answers, decided by the database. Adding
 * `reporter=eq.<me>` would make it look right while the policy did nothing, which is how RLS ends
 * up decorative.
 */
export function listIssues(): Promise<Issue[]> {
  return asUser<Issue[]>('issues', `issues?select=${ISSUE_COLS}&order=created_at.desc`)
}

export function insertIssue(row: Record<string, unknown>): Promise<Issue[]> {
  return asUser<Issue[]>('issue insert', 'issues', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
}

export function patchIssue(id: string, patch: Record<string, unknown>): Promise<null> {
  return asUser<null>('issue update', `issues?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  })
}

/**
 * The `Working Record` tab, captured rather than typed.
 *
 * A session is opened by filing an issue and extended by the next one; a gap longer than the window
 * starts a new one. Nobody opens a second tab, which is exactly why that tab held zero rows from
 * the day it was created.
 */
const SESSION_GAP_MINUTES = 60

export async function touchSession(testerId: string): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_GAP_MINUTES * 60_000).toISOString()
  const open = await asUser<{ id: string; issue_count: number }[]>(
    'session lookup',
    `testing_sessions?select=id,issue_count&tester=eq.${testerId}&last_seen_at=gte.${cutoff}&order=last_seen_at.desc&limit=1`,
  )
  const now = new Date().toISOString()
  if (open[0]) {
    await asUser<null>('session extend', `testing_sessions?id=eq.${open[0].id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_seen_at: now, issue_count: open[0].issue_count + 1 }),
    })
    return
  }
  await asUser<null>('session start', 'testing_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ tester: testerId, started_at: now, last_seen_at: now, issue_count: 1 }),
  })
}

export function listSessions(testerId?: string): Promise<
  { id: string; tester: string; started_at: string; last_seen_at: string; issue_count: number }[]
> {
  const filter = testerId ? `&tester=eq.${testerId}` : ''
  return asUser('sessions', `testing_sessions?select=id,tester,started_at,last_seen_at,issue_count&order=last_seen_at.desc${filter}`)
}

/** Names for the reporter column. An admin can read every profile — `profiles_read_all_if_admin`. */
export function listProfiles(): Promise<{ user_id: string; name: string; role: string }[]> {
  return asUser('profiles', 'profiles?select=user_id,name,role&order=name.asc')
}
