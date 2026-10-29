/**
 * Supabase clients used by the API server.
 *
 * Important: the server never uses a service-role key. Every query runs with
 * the caller's access token, so Postgres Row Level Security applies exactly as
 * it would in the browser. That means a bug in an endpoint cannot leak another
 * team's data - the database refuses the rows.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from './config.js';

export class UnauthorizedError extends Error {
  status = 401;
}

function baseOptions(token?: string) {
  return {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  };
}

/** Client bound to a single user's JWT (RLS enforced). */
export function userClient(config: ServerConfig, token: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, baseOptions(token));
}

/** Anonymous client used only to verify a JWT. */
export function anonClient(config: ServerConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, baseOptions());
}

export interface AuthedUser {
  id: string;
  email: string | null;
}

export async function verifyToken(config: ServerConfig, token: string): Promise<AuthedUser> {
  const { data, error } = await anonClient(config).auth.getUser(token);
  if (error || !data.user) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }
  return { id: data.user.id, email: data.user.email ?? null };
}
