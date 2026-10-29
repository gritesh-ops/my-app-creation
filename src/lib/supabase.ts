/**
 * Single Supabase browser client.
 *
 * Only the anon key is used here. Every table is protected by Row Level
 * Security, and the Gemini key lives exclusively on the server.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RuntimeConfig } from './config.js';

let client: SupabaseClient | null = null;

export function initSupabase(config: RuntimeConfig): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase is not configured.');
  }
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'teampilot-auth',
    },
  });
  return client;
}

export function supabase(): SupabaseClient {
  if (!client) throw new Error('Supabase client used before initialisation.');
  return client;
}
