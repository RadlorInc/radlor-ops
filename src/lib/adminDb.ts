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
