/**
 * Runtime configuration.
 *
 * The browser asks the server for the Supabase URL and anon key instead of
 * baking them in at build time. That means the same Docker image can be
 * deployed and configured later - and the anon key is public by design, so
 * nothing secret is exposed here.
 */

export interface RuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  aiConfigured: boolean;
}

let pending: Promise<RuntimeConfig> | null = null;

function fromBuildEnv(): RuntimeConfig {
  const env = import.meta.env;
  return {
    supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined) ?? '',
    supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
    aiConfigured: true,
  };
}

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Partial<RuntimeConfig> & {
        supabase_url?: string;
        supabase_anon_key?: string;
        ai_configured?: boolean;
      };
      const config: RuntimeConfig = {
        supabaseUrl: data.supabase_url ?? data.supabaseUrl ?? '',
        supabaseAnonKey: data.supabase_anon_key ?? data.supabaseAnonKey ?? '',
        aiConfigured: Boolean(data.ai_configured ?? data.aiConfigured),
      };
      if (config.supabaseUrl && config.supabaseAnonKey) return config;
      // Fall back to build-time values if the API route is unavailable.
      const fallback = fromBuildEnv();
      return fallback.supabaseUrl ? fallback : config;
    } catch {
      return fromBuildEnv();
    }
  })();
  return pending;
}
